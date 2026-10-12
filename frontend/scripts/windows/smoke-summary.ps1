param(
  [Parameter(Mandatory=$true)][string]$Helper,
  [Parameter(Mandatory=$true)][string]$Model,
  [Parameter(Mandatory=$true)][string]$RuntimeDirectory,
  [Parameter(Mandatory=$true)][string]$Catalog,
  [Parameter(Mandatory=$true)][string]$OutputFile,
  [Parameter(Mandatory=$true)][ValidateSet('x86_64-pc-windows-msvc','aarch64-pc-windows-msvc')][string]$Target
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$fingerprints = [IO.File]::ReadAllText((Resolve-Path $Catalog).Path) | ConvertFrom-Json
$spec = $fingerprints.'llm-qwen/Qwen3.5-2B-Q4_K_M.gguf'
if ((Get-Item $Model).Length -ne $spec.size -or (Get-FileHash $Model -Algorithm SHA256).Hash -ne $spec.sha256) {
  throw 'Summary smoke model failed the pinned catalog fingerprint'
}
$bytes = [IO.File]::ReadAllBytes($Helper)
$pe = [BitConverter]::ToInt32($bytes,60)
$machine = [BitConverter]::ToUInt16($bytes,$pe+4)
$expected = if ($Target -eq 'aarch64-pc-windows-msvc') { 0xaa64 } else { 0x8664 }
if ($machine -ne $expected) { throw 'Summary helper machine type differs from the requested target' }
$prompt = "<|im_start|>system`nSummarize the meeting in one short sentence. Preserve the name and deadline.<|im_end|>`n<|im_start|>user`nAlex will test the Windows installer on Friday.<|im_end|>`n<|im_start|>assistant`n<think>`n`n</think>`n`n"
$request = @{type='generate';prompt=$prompt;model_path=(Resolve-Path $Model).Path;max_tokens=64;context_size=1024;temperature=0;stop_tokens=@('<|im_end|>')} | ConvertTo-Json -Compress
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = (Resolve-Path $Helper).Path
$start.WorkingDirectory = (Resolve-Path $RuntimeDirectory).Path
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.EnvironmentVariables['PATH'] = "$RuntimeDirectory;$env:SystemRoot\System32;$env:SystemRoot"
$process = New-Object Diagnostics.Process
$process.StartInfo = $start
[void]$process.Start()
$stdout = $process.StandardOutput.ReadToEndAsync()
$stderr = $process.StandardError.ReadToEndAsync()
$process.StandardInput.WriteLine($request)
$process.StandardInput.WriteLine('{"type":"shutdown"}')
$process.StandardInput.Close()
if (!$process.WaitForExit(180000)) { $process.Kill(); throw 'Native summary model smoke timed out' }
$out = $stdout.GetAwaiter().GetResult()
$err = $stderr.GetAwaiter().GetResult()
$messages = @($out -split '\r?\n' | Where-Object {$_} | ForEach-Object {$_ | ConvertFrom-Json})
$responses = @($messages | Where-Object {$_.type -eq 'response'})
if ($process.ExitCode -ne 0 -or $responses.Count -ne 1 -or $responses[0].error -or
    $responses[0].text -notmatch 'Alex' -or $responses[0].text -notmatch 'Friday' -or
    !($messages | Where-Object {$_.type -eq 'goodbye'})) {
  throw "Native summary model smoke failed. Exit=$($process.ExitCode); stdout=$out; stderr=$($err.Substring([Math]::Max(0,$err.Length-8000)))"
}
$record = [ordered]@{
  Target=$Target; Model='Qwen3.5-2B-Q4_K_M.gguf'; ModelSHA256=$spec.sha256
  HelperSHA256=(Get-FileHash $Helper -Algorithm SHA256).Hash.ToLowerInvariant()
  NativeModelInference='passed'; SyntheticInput='Alex will test the Windows installer on Friday.'
  Response=$responses[0].text; CleanShutdown='passed'; AudioDevicesUsed=$false
}
[IO.File]::WriteAllText($OutputFile,($record | ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
$record | ConvertTo-Json -Depth 4
