use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;
use transcribe_rs::audio::read_wav_samples;
use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::Quantization;
use transcribe_rs::{SpeechModel, TranscribeOptions};

#[derive(Serialize)]
struct TranscriptJson {
    text: String,
    raw_text: String,
    model_id: String,
    duration_ms: u128,
    audio_duration_ms: u64,
    language: Option<String>,
    post_processed: bool,
}

fn arg_value(args: &[String], name: &str) -> Result<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
        .ok_or_else(|| anyhow!("missing required argument: {}", name))
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("transcribe") {
        return Err(anyhow!(
            "usage: escalaflow-stt transcribe --model-dir <dir> --audio <wav> --json"
        ));
    }

    let model_dir = PathBuf::from(arg_value(&args, "--model-dir")?);
    let audio_path = PathBuf::from(arg_value(&args, "--audio")?);
    let started = Instant::now();

    let result = transcribe_parakeet(&model_dir, &audio_path)?;
    let json = TranscriptJson {
        text: result.text.trim().to_string(),
        raw_text: result.text.trim().to_string(),
        model_id: "parakeet-v3-int8".to_string(),
        duration_ms: started.elapsed().as_millis(),
        audio_duration_ms: result.audio_duration_ms,
        language: Some("auto".to_string()),
        post_processed: false,
    };

    println!("{}", serde_json::to_string(&json)?);
    Ok(())
}

struct LocalTranscript {
    text: String,
    audio_duration_ms: u64,
}

fn transcribe_parakeet(model_dir: &PathBuf, audio_path: &PathBuf) -> Result<LocalTranscript> {
    let samples = read_wav_samples(audio_path)
        .with_context(|| format!("failed to read WAV {}", audio_path.display()))?;
    let audio_duration_ms = ((samples.len() as f64 / 16_000.0) * 1000.0).round() as u64;
    let mut model = ParakeetModel::load(model_dir, &Quantization::Int8)
        .with_context(|| format!("failed to load Parakeet model from {}", model_dir.display()))?;
    let result = model
        .transcribe(&samples, &TranscribeOptions::default())
        .with_context(|| format!("failed to transcribe {}", audio_path.display()))?;
    Ok(LocalTranscript {
        text: result.text,
        audio_duration_ms,
    })
}
