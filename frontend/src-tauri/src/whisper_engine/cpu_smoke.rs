use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[test]
#[ignore = "requires the verified bundled Whisper Tiny model"]
fn bundled_tiny_cpu_decode() {
    let path = std::path::PathBuf::from(
        std::env::var_os("TETRO_WHISPER_SMOKE_MODEL").expect("Set TETRO_WHISPER_SMOKE_MODEL"),
    );
    crate::model_integrity::verify(&path, "stt-whisper/ggml-tiny.bin")
        .expect("Smoke model must match the pinned Tiny fingerprint");
    let mut context_params = WhisperContextParameters::default();
    context_params.use_gpu(false);
    let context = WhisperContext::new_with_params(&path.to_string_lossy(), context_params)
        .expect("Native CPU model initialization failed");
    let mut state = context.create_state().expect("Native decoder state failed");
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(2);
    params.set_language(Some("en"));
    params.set_no_context(true);
    params.set_no_speech_thold(1.0);
    params.set_max_tokens(16);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    // Input exists only in memory. No speaker, microphone, or audio device is used.
    let samples: Vec<f32> = (0..32_000)
        .map(|n| (n as f32 * std::f32::consts::TAU * 440.0 / 16_000.0).sin() * 0.01)
        .collect();
    state.full(params, &samples).expect("Native CPU decode failed");
    let logits = state.get_logits().expect("Native decoder produced no logits");
    assert!(!logits.is_empty());
    assert!(logits.iter().any(|v| v.is_finite()));
    assert!(logits.iter().all(|v| !v.is_nan() && *v != f32::INFINITY));
    println!("Verified Tiny CPU decode passed on {}", std::env::consts::ARCH);
}
