use sha2::{Digest, Sha256};
use std::{
    env,
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    process,
};

#[cfg(windows)]
use std::os::windows::fs::MetadataExt;

const ARCHIVE_URL: &str = "https://github.com/microsoft/onnxruntime/releases/download/v1.22.0/onnxruntime-win-x64-1.22.0.zip";
const ARCHIVE_SHA256: &str = "174c616efc0271194488642a72f1a514e01487da4dfe84c49296d66e40ebe0da";
const ARCHIVE_SIZE: u64 = 72_368_545;

#[derive(Clone, Copy)]
struct Artifact {
    archive_path: &'static str,
    output_name: &'static str,
    size: u64,
    sha256: &'static str,
}

const X64_ARTIFACTS: [Artifact; 3] = [
    Artifact {
        archive_path: "onnxruntime-win-x64-1.22.0/lib/onnxruntime.dll",
        output_name: "onnxruntime.dll",
        size: 12_418_080,
        sha256: "579b636403983254346a5c1d80bd28f1519cd1e284cd204f8d4ff41f8d711559",
    },
    Artifact {
        archive_path: "onnxruntime-win-x64-1.22.0/lib/onnxruntime_providers_shared.dll",
        output_name: "onnxruntime_providers_shared.dll",
        size: 22_064,
        sha256: "ba00ea1ef846c9b909c7854bc56c51051a20f9773b3e1153dda118d4b85d0b93",
    },
    Artifact {
        archive_path: "onnxruntime-win-x64-1.22.0/LICENSE",
        output_name: "onnxruntime-LICENSE.txt",
        size: 1_094,
        sha256: "c250d6278f0b47a6439fb7592b08b58a55eb9f535aa49a1db63211c3f982b674",
    },
];


const ARM64_ARTIFACTS: [Artifact; 3] = [
    Artifact { archive_path: "onnxruntime-win-arm64-1.22.0/lib/onnxruntime.dll", output_name: "onnxruntime.dll", size: 12_679_728, sha256: "79281671a386ed1baab9dbdbb09fe55f99577011472e9526cf9d0b468bb6bcc7" },
    Artifact { archive_path: "onnxruntime-win-arm64-1.22.0/lib/onnxruntime_providers_shared.dll", output_name: "onnxruntime_providers_shared.dll", size: 21_048, sha256: "e80bf226d099fc040f4f18b5d65aa1ae33bcb3f5821f9570b866c4a64e410c83" },
    Artifact { archive_path: "onnxruntime-win-arm64-1.22.0/LICENSE", output_name: "onnxruntime-LICENSE.txt", size: 1_094, sha256: "c250d6278f0b47a6439fb7592b08b58a55eb9f535aa49a1db63211c3f982b674" },
];
struct RuntimeSpec {
    archive_url: &'static str,
    archive_sha256: &'static str,
    archive_size: u64,
    artifacts: &'static [Artifact],
    machine: u16,
}
fn runtime_for_target(target: &str) -> Result<RuntimeSpec, String> {
    match target {
        "x86_64-pc-windows-msvc" => Ok(RuntimeSpec { archive_url: ARCHIVE_URL, archive_sha256: ARCHIVE_SHA256, archive_size: ARCHIVE_SIZE, artifacts: &X64_ARTIFACTS, machine: 0x8664 }),
        "aarch64-pc-windows-msvc" => Ok(RuntimeSpec { archive_url: "https://github.com/microsoft/onnxruntime/releases/download/v1.22.0/onnxruntime-win-arm64-1.22.0.zip", archive_sha256: "7008f7ff82f8e7de563a22f2b590e08e706a1289eba606b93de2b56edfb1e04b", archive_size: 73_055_483, artifacts: &ARM64_ARTIFACTS, machine: 0xaa64 }),
        _ => Err(format!("No verified ONNX Runtime for {target}")),
    }
}
fn verify_machine(path: &Path, expected: u16) -> Result<(), String> {
    use std::io::{Seek, SeekFrom};
    let mut file=File::open(path).map_err(|e|e.to_string())?;
    let mut header=[0_u8;64];
    file.read_exact(&mut header).map_err(|e|e.to_string())?;
    if &header[..2]!=b"MZ" {return Err("ONNX DLL has no DOS header".into());}
    let offset=u32::from_le_bytes(header[60..64].try_into().unwrap()) as u64;
    file.seek(SeekFrom::Start(offset)).map_err(|e|e.to_string())?;
    let mut pe=[0_u8;6];
    file.read_exact(&mut pe).map_err(|e|e.to_string())?;
    if &pe[..4]!=b"PE\0\0" || u16::from_le_bytes([pe[4],pe[5]])!=expected {
        return Err("ONNX DLL machine type does not match build target".into());
    }
    Ok(())
}

pub fn ensure_onnxruntime_runtime() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    println!("cargo:rerun-if-changed=binaries/onnxruntime");

    let target = env::var("TARGET").expect("TARGET environment variable not set");
    let spec=runtime_for_target(&target).unwrap_or_else(|error| panic!("{error}"));

    let manifest_dir =
        env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR environment variable not set");
    let destination = Path::new(&manifest_dir)
        .join("binaries")
        .join("onnxruntime");

    match verify_staged_runtime(&destination, &spec) {
        Ok(()) => {
            println!(
                "cargo:warning=Using verified bundled ONNX Runtime from {}",
                destination.display()
            );
            return;
        }
        Err(verification_error) => match fs::symlink_metadata(&destination) {
            Ok(metadata) if is_link_or_reparse_point(&metadata) => {
                panic!(
                    "Refusing to replace linked or reparse-point ONNX Runtime stage at {}: {verification_error}",
                    destination.display()
                );
            }
            Ok(metadata) if metadata.is_dir() => {
                println!(
                    "cargo:warning=Replacing invalid bundled ONNX Runtime: {verification_error}"
                );
                fs::remove_dir_all(&destination).unwrap_or_else(|remove_error| {
                    panic!(
                        "Failed to remove invalid ONNX Runtime directory at {}: {remove_error}",
                        destination.display()
                    )
                });
            }
            Ok(metadata) if metadata.is_file() => {
                println!(
                    "cargo:warning=Replacing invalid bundled ONNX Runtime: {verification_error}"
                );
                fs::remove_file(&destination).unwrap_or_else(|remove_error| {
                    panic!(
                        "Failed to remove invalid ONNX Runtime file at {}: {remove_error}",
                        destination.display()
                    )
                });
            }
            Ok(_) => {
                panic!(
                    "Refusing to replace special ONNX Runtime stage at {}: {verification_error}",
                    destination.display()
                );
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                panic!(
                    "Failed to inspect invalid ONNX Runtime stage at {}: {error}",
                    destination.display()
                );
            }
        },
    }

    fs::create_dir_all(
        destination
            .parent()
            .expect("ONNX Runtime destination has no parent"),
    )
    .expect("Failed to create ONNX Runtime binaries directory");

    let temporary_archive = env::temp_dir().join(format!(
        "meetily-onnxruntime-{}-{}.zip",
        process::id(),
        target
    ));
    let temporary_destination =
        destination.with_file_name(format!(".onnxruntime-{}-{}", process::id(), target));
    let _ = fs::remove_file(&temporary_archive);
    let _ = fs::remove_dir_all(&temporary_destination);

    let result = stage_runtime(&temporary_archive, &temporary_destination, &spec);
    let _ = fs::remove_file(&temporary_archive);

    if let Err(error) = result {
        let _ = fs::remove_dir_all(&temporary_destination);
        panic!("Failed to stage bundled ONNX Runtime: {error}");
    }

    fs::rename(&temporary_destination, &destination).unwrap_or_else(|error| {
        let _ = fs::remove_dir_all(&temporary_destination);
        panic!(
            "Failed to finalize bundled ONNX Runtime at {}: {error}",
            destination.display()
        );
    });

    verify_staged_runtime(&destination, &spec).unwrap_or_else(|error| {
        panic!("Bundled ONNX Runtime verification failed after staging: {error}")
    });
    println!(
        "cargo:warning=Bundled verified ONNX Runtime at {}",
        destination.display()
    );
}

fn stage_runtime(archive_path: &Path, destination: &Path, spec: &RuntimeSpec) -> Result<(), String> {
    download_archive(archive_path, spec)?;
    verify_file(archive_path, spec.archive_url, spec.archive_size, spec.archive_sha256)?;

    fs::create_dir_all(destination)
        .map_err(|error| format!("failed to create {}: {error}", destination.display()))?;

    let archive_file = File::open(archive_path)
        .map_err(|error| format!("failed to open {}: {error}", archive_path.display()))?;
    let mut archive = zip::ZipArchive::new(archive_file)
        .map_err(|error| format!("failed to read ONNX Runtime archive: {error}"))?;

    for artifact in spec.artifacts {
        let mut source = archive.by_name(artifact.archive_path).map_err(|error| {
            format!(
                "missing {} in ONNX Runtime archive: {error}",
                artifact.archive_path
            )
        })?;
        let output = destination.join(artifact.output_name);
        let mut file = File::create(&output)
            .map_err(|error| format!("failed to create {}: {error}", output.display()))?;
        std::io::copy(&mut source, &mut file)
            .map_err(|error| format!("failed to extract {}: {error}", artifact.archive_path))?;
        verify_file(
            &output,
            artifact.output_name,
            artifact.size,
            artifact.sha256,
        )?;
    }

    Ok(())
}

fn download_archive(destination: &Path, spec: &RuntimeSpec) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|error| format!("failed to create download client: {error}"))?;
    let mut response = client
        .get(spec.archive_url)
        .send()
        .map_err(|error| format!("failed to download ONNX Runtime: {error}"))?
        .error_for_status()
        .map_err(|error| format!("ONNX Runtime download failed: {error}"))?;
    let mut file = File::create(destination)
        .map_err(|error| format!("failed to create {}: {error}", destination.display()))?;
    copy_exact(&mut response, &mut file, spec.archive_size)
}

fn copy_exact<R: Read, W: Write>(
    source: &mut R,
    destination: &mut W,
    expected_size: u64,
) -> Result<(), String> {
    let copied = std::io::copy(
        &mut source.by_ref().take(expected_size),
        destination,
    )
    .map_err(|error| format!("failed to copy ONNX Runtime download: {error}"))?;
    if copied != expected_size {
        return Err(format!(
            "downloaded ONNX Runtime archive has size {copied}, expected {expected_size}"
        ));
    }

    let mut probe = [0_u8; 1];
    if source
        .read(&mut probe)
        .map_err(|error| format!("failed to copy ONNX Runtime download: {error}"))?
        != 0
    {
        return Err(format!(
            "downloaded ONNX Runtime archive exceeds expected size {expected_size}"
        ));
    }

    Ok(())
}

fn is_link_or_reparse_point(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }

    #[cfg(windows)]
    {
        return metadata.file_attributes() & 0x0000_0400 != 0;
    }

    #[cfg(not(windows))]
    false
}

fn verify_staged_runtime(destination: &Path, spec: &RuntimeSpec) -> Result<(), String> {
    let metadata = fs::symlink_metadata(destination)
        .map_err(|error| format!("failed to inspect runtime stage: {error}"))?;
    if is_link_or_reparse_point(&metadata) {
        return Err("runtime stage is a link or reparse point".to_string());
    }
    if !metadata.file_type().is_dir() {
        return Err("runtime stage is not a directory".to_string());
    }

    let entries = fs::read_dir(destination)
        .map_err(|error| format!("failed to enumerate runtime stage: {error}"))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("failed to enumerate runtime stage entry: {error}"))?;
        let entry_metadata = fs::symlink_metadata(entry.path()).map_err(|error| {
            format!(
                "failed to inspect runtime stage entry {}: {error}",
                entry.path().display()
            )
        })?;
        if is_link_or_reparse_point(&entry_metadata) {
            return Err(format!(
                "runtime stage entry {} is a link or reparse point",
                entry.path().display()
            ));
        }
        if !entry_metadata.file_type().is_file() {
            return Err(format!(
                "runtime stage entry {} is not a regular file",
                entry.path().display()
            ));
        }

        let name = entry.file_name();
        if !spec.artifacts
            .iter()
            .any(|artifact| name.as_os_str() == artifact.output_name)
        {
            return Err(format!(
                "runtime stage contains undeclared entry {}",
                entry.path().display()
            ));
        }
    }

    for artifact in spec.artifacts {
        verify_file(
            &destination.join(artifact.output_name),
            artifact.output_name,
            artifact.size,
            artifact.sha256,
        )?;
        if artifact.output_name.ends_with(".dll") {
            verify_machine(&destination.join(artifact.output_name), spec.machine)?;
        }
    }
    Ok(())
}

fn verify_file(
    path: &Path,
    name: &str,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("failed to inspect {name}: {error}"))?;
    if metadata.len() != expected_size {
        return Err(format!(
            "{name} has size {}, expected {expected_size}",
            metadata.len()
        ));
    }

    let mut file = File::open(path).map_err(|error| format!("failed to open {name}: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("failed to hash {name}: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let actual_sha256 = format!("{:x}", hasher.finalize());
    if actual_sha256 != expected_sha256 {
        return Err(format!(
            "{name} has SHA-256 {actual_sha256}, expected {expected_sha256}"
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_targets_have_independent_pins_and_reject_unsupported_architecture() {
        let x64=runtime_for_target("x86_64-pc-windows-msvc").unwrap();
        let arm=runtime_for_target("aarch64-pc-windows-msvc").unwrap();
        assert_eq!(x64.machine,0x8664);
        assert_eq!(arm.machine,0xaa64);
        assert_ne!(x64.archive_sha256,arm.archive_sha256);
        assert_ne!(x64.artifacts[0].sha256,arm.artifacts[0].sha256);
        assert!(runtime_for_target("i686-pc-windows-msvc").is_err());
    }
    #[test]
    fn rejects_wrong_machine_and_malformed_dll() {
        let dir=tempfile::tempdir().unwrap();let file=dir.path().join("onnxruntime.dll");
        let mut bytes=vec![0_u8;70];bytes[..2].copy_from_slice(b"MZ");
        bytes[60..64].copy_from_slice(&64_u32.to_le_bytes());
        bytes[64..68].copy_from_slice(b"PE\0\0");bytes[68..70].copy_from_slice(&0x8664_u16.to_le_bytes());
        fs::write(&file,&bytes).unwrap();
        assert!(verify_machine(&file,0x8664).is_ok());
        assert!(verify_machine(&file,0xaa64).is_err());
        fs::write(&file,b"malformed").unwrap();assert!(verify_machine(&file,0x8664).is_err());
    }
    #[test]
    fn archive_copy_rejects_truncation_and_extra_bytes() {
        assert!(copy_exact(&mut &b"ab"[..],&mut Vec::new(),3).is_err());
        assert!(copy_exact(&mut &b"abcd"[..],&mut Vec::new(),3).is_err());
        assert!(copy_exact(&mut &b"abc"[..],&mut Vec::new(),3).is_ok());
    }
}
