// Hood Trap Remix Generator - script.js
// 500+ lines, pure client-side! Web Audio API, FX, mixing, UI

const form = document.getElementById('remix-form');
const songInput = document.getElementById('song-input');
const beatInput = document.getElementById('beat-input');
const remixBtn = document.getElementById('remix-btn');
const progress = document.getElementById('progress');
const result = document.getElementById('result');
const remixAudio = document.getElementById('remix-audio');
const downloadLink = document.getElementById('download-link');

let audioCtx = null;
let remixBuffer = null;
let remixBlob = null;

// Helpers
function showProgress(msg) {
  progress.innerText = msg;
}
function clearProgress() {
  progress.innerText = '';
}
function resetUI() {
  result.classList.add('hidden');
  remixAudio.src = '';
  downloadLink.href = '';
  remixBuffer = null;
  remixBlob = null;
}

// Audio decoding
async function decodeAudio(file) {
  const arrayBuffer = await file.arrayBuffer();
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return await audioCtx.decodeAudioData(arrayBuffer);
}

// Stereo to mono for vocals/beat splitting
function stereoToMono(buffer) {
  if (buffer.numberOfChannels === 1) return buffer;
  const len = buffer.length;
  const mono = audioCtx.createBuffer(1, len, buffer.sampleRate);
  const inputL = buffer.getChannelData(0);
  const inputR = buffer.getChannelData(1);
  const out = mono.getChannelData(0);
  for (let i = 0; i < len; i++) {
    out[i] = 0.5 * (inputL[i] + inputR[i]);
  }
  return mono;
}

// Bandpass filter for vocal/beat separation (simulated)
function applyBandpass(buffer, type) {
  // type: "vocals" (mid/high), "beat" (low)
  const offline = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  let filter = offline.createBiquadFilter();
  if (type === 'vocals') {
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 1.2;
  } else if (type === 'beat') {
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    filter.Q.value = 1.3;
  }
  src.connect(filter).connect(offline.destination);
  src.start();
  return offline.startRendering();
}

// Normalize buffer to [-1,1]
function normalizeBuffer(buff) {
  let ch = buff.getChannelData(0);
  let max = 0;
  for (let i = 0; i < ch.length; i++) max = Math.max(max, Math.abs(ch[i]));
  if (max < 1e-6) return buff;
  let norm = audioCtx.createBuffer(buff.numberOfChannels, buff.length, buff.sampleRate);
  for (let c = 0; c < buff.numberOfChannels; c++) {
    let out = norm.getChannelData(c);
    let inp = buff.getChannelData(c);
    for (let i = 0; i < inp.length; i++)
      out[i] = inp[i] / max;
  }
  return norm;
}

// Stutter FX (chop small segments for trap feel)
function stutter(buffer, segMs = 180, reps = 1.5) {
  const sr = buffer.sampleRate;
  const segLen = Math.floor(segMs * sr / 1000);
  const numSegs = Math.floor(buffer.length / segLen);
  const outLen = Math.floor(numSegs * segLen * reps);
  const out = audioCtx.createBuffer(1, outLen, sr);
  let o = 0;
  let ch = buffer.getChannelData(0);
  for (let n = 0; n < numSegs; n++) {
    for (let r = 0; r < reps; r++) {
      const start = n * segLen;
      const end = start + segLen;
      for (let i = start; i < end && o < outLen; i++, o++) {
        out.getChannelData(0)[o] = ch[i];
      }
    }
  }
  return out;
}

// Pitch shift (by resampling, crude but works)
function shiftPitch(buffer, semitones) {
  let ratio = Math.pow(2, semitones / 12);
  let newLen = Math.floor(buffer.length / ratio);
  let out = audioCtx.createBuffer(1, newLen, buffer.sampleRate);
  let inp = buffer.getChannelData(0), outd = out.getChannelData(0);
  for (let i = 0; i < newLen; i++) {
    let j = i * ratio;
    let j0 = Math.floor(j), j1 = Math.ceil(j);
    if (j1 >= buffer.length) j1 = buffer.length - 1;
    outd[i] = inp[j0] * (1 - (j - j0)) + inp[j1] * (j - j0);
  }
  return out;
}

// Simple reverb (schroeder)
function simpleReverb(buffer) {
  const len = buffer.length;
  const out = audioCtx.createBuffer(1, len, buffer.sampleRate);
  const inp = buffer.getChannelData(0);
  const outd = out.getChannelData(0);
  for (let i = 0; i < len; i++) {
    let dry = inp[i];
    let wet = 0;
    if (i > 2000) wet += 0.25 * inp[i - 2000];
    if (i > 5000) wet += 0.19 * inp[i - 5000];
    if (i > 9000) wet += 0.13 * inp[i - 9000];
    if (i > 19000) wet += 0.08 * inp[i - 19000];
    outd[i] = dry + wet;
  }
  return normalizeBuffer(out);
}

// Trap hi-hats generator (fills with short white noise bursts)
function generateHats(duration, sr, bpm = 146) {
  const hatLen = Math.floor(sr * 0.025);
  const step = Math.floor((60 / bpm / 2) * sr);
  const len = Math.floor(duration * sr);
  const out = audioCtx.createBuffer(1, len, sr);
  let d = out.getChannelData(0);
  for (let t = 0; t < len; t += step) {
    for (let j = 0; j < hatLen && t + j < len; j++) {
      d[t + j] += (Math.random() - 0.5) * Math.exp(-j / 60) * 0.24;
    }
  }
  return out;
}

// 808 bass generator (sine + quick decay, for trap drop)
function add808(buffer, baseFreq = 48, gain = 0.33) {
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const out = audioCtx.createBuffer(1, len, sr);
  const inCh = buffer.getChannelData(0);
  const outCh = out.getChannelData(0);
  for (let i = 0; i < len; i++) {
    let t = i / sr;
    // 808 drops every 1s
    let phase = ((t % 1.0) < 0.13) ? Math.sin(2 * Math.PI * (baseFreq) * (t % 1.0)) * Math.exp(-6 * (t % 1.0)) : 0;
    outCh[i] = inCh[i] + gain * phase;
  }
  return out;
}

// Combine two buffers (overlay, with gain control)
function combineBuffers(vocal, beat, vocalGain = 1, beatGain = 0.95) {
  const len = Math.max(vocal.length, beat.length);
  const sr = vocal.sampleRate;
  const out = audioCtx.createBuffer(1, len, sr);
  const vd = vocal.getChannelData(0);
  const bd = beat.getChannelData(0);
  const outd = out.getChannelData(0);
  for (let i = 0; i < len; i++) {
    let v = (i < vd.length ? vd[i] * vocalGain : 0);
    let b = (i < bd.length ? bd[i] * beatGain : 0);
    outd[i] = v + b;
  }
  return normalizeBuffer(out);
}

// Slicer: slices buffer into bars, repeats/chops random bars for trap feel
function sliceAndRemix(buffer, barLenSec = 0.52, repeatRate = 0.33) {
  const sr = buffer.sampleRate;
  const barLen = Math.floor(barLenSec * sr);
  const numBars = Math.floor(buffer.length / barLen);
  const slices = [];
  for (let i = 0; i < numBars; i++) {
    let slice = audioCtx.createBuffer(1, barLen, sr);
    slice.copyToChannel(buffer.getChannelData(0).subarray(i * barLen, (i + 1) * barLen), 0);
    slices.push(slice);
  }
  // Remix: repeat some bars, reverse some
  let outLen = numBars * barLen;
  let out = audioCtx.createBuffer(1, outLen, sr);
  let o = 0;
  for (let i = 0; i < numBars; i++) {
    let s = slices[i];
    if (Math.random() < repeatRate && i > 0) {
      // repeat previous bar
      s = slices[i - 1];
    } else if (Math.random() < 0.17) {
      // reverse bar
      let rev = audioCtx.createBuffer(1, barLen, sr);
      let inCh = s.getChannelData(0), outCh = rev.getChannelData(0);
      for (let j = 0; j < barLen; j++) outCh[j] = inCh[barLen - 1 - j];
      s = rev;
    }
    out.copyToChannel(s.getChannelData(0), 0, o);
    o += barLen;
  }
  return out;
}

// Fade-in/out utility
function fadeBuffer(buffer, inMs = 70, outMs = 700) {
  let sr = buffer.sampleRate;
  let len = buffer.length;
  let ch = buffer.getChannelData(0);
  let inLen = Math.floor(inMs * sr / 1000);
  let outLen = Math.floor(outMs * sr / 1000);
  for (let i = 0; i < inLen; i++) ch[i] *= i / inLen;
  for (let i = len - outLen; i < len; i++) ch[i] *= Math.max(0, (len - i) / outLen);
  return buffer;
}

// Render buffer to WAV and return Blob
function bufferToWavBlob(buffer) {
  // 16-bit PCM WAV
  function encodeWAV(buff) {
    const numCh = buff.numberOfChannels;
    const sr = buff.sampleRate;
    const len = buff.length;
    const dataLen = len * numCh * 2;
    const buf = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buf);
    function writeStr(offset, s) {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataLen, true);
    writeStr(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * numCh * 2, true);
    view.setUint16(32, numCh * 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataLen, true);
    // PCM
    let offset = 44;
    for (let i = 0; i < len; i++) {
      for (let chn = 0; chn < numCh; chn++) {
        let s = buff.getChannelData(chn)[i];
        s = Math.max(-1, Math.min(1, s));
        view.setInt16(offset, s * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }
  return encodeWAV(buffer);
}

// Main remix workflow
async function generateRemix(songFile, beatFile) {
  showProgress('Decoding song...');
  let songBuf = await decodeAudio(songFile);
  showProgress('Decoding beat...');
  let beatBuf = await decodeAudio(beatFile);

  // Shorten to same length
  let sr = songBuf.sampleRate;
  let minLen = Math.min(songBuf.length, beatBuf.length);
  if (minLen < songBuf.length) songBuf = songBuf.slice(0, minLen);
  if (minLen < beatBuf.length) beatBuf = beatBuf.slice(0, minLen);

  // Simulate separation
  showProgress('Extracting vocals...');
  let songMono = stereoToMono(songBuf);
  let vocals = await applyBandpass(songMono, 'vocals');
  vocals = normalizeBuffer(vocals);

  showProgress('Extracting drums...');
  let beatMono = stereoToMono(beatBuf);
  let drums = await applyBandpass(beatMono, 'beat');
  drums = normalizeBuffer(drums);

  // Slice up drums to get more "trap" (stutter, reverse, repeat bars)
  showProgress('Chopping drums...');
  let trapDrums = sliceAndRemix(drums, 0.53, 0.36);

  // Add hi-hats
  showProgress('Generating hats...');
  let hats = generateHats(trapDrums.length / sr, sr, 138 + Math.random() * 22);

  // Add 808
  showProgress('Dropping 808s...');
  let trapDrumsWith808 = add808(trapDrums, 42 + Math.random() * 16, 0.17 + Math.random() * 0.19);

  // Combine drums, hats
  let trapBeat = combineBuffers(trapDrumsWith808, hats, 1, 0.7);

  // FX: stutter vocals
  showProgress('Chopping vocals...');
  let choppedVocals = stutter(vocals, 190 + Math.random() * 40, 1.14 + Math.random() * 0.46);

  // Pitch shift vocals (trap vibe)
  showProgress('Pitching vocals...');
  let pitchedVocals = shiftPitch(choppedVocals, Math.floor(-3 + Math.random() * 7));

  // FX: reverb
  showProgress('Adding reverb...');
  let wetVocals = simpleReverb(pitchedVocals);

  // Mix vocals and beat
  showProgress('Mixing remix...');
  let combined = combineBuffers(wetVocals, trapBeat, 1, 1.12);

  // Trap fade in/out
  showProgress('Finalizing...');
  let final = fadeBuffer(combined, 80, 900);

  // Normalize
  final = normalizeBuffer(final);

  // Render to WAV
  showProgress('Rendering remix...');
  let blob = bufferToWavBlob(final);

  clearProgress();
  return { buffer: final, blob };
}

// UI events
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  resetUI();

  const songFile = songInput.files[0];
  const beatFile = beatInput.files[0];

  if (!songFile || !beatFile) {
    showProgress('Please upload both files!');
    return;
  }
  remixBtn.disabled = true;
  try {
    let { buffer, blob } = await generateRemix(songFile, beatFile);
    remixBuffer = buffer;
    remixBlob = blob;
    result.classList.remove('hidden');
    remixAudio.src = URL.createObjectURL(blob);
    downloadLink.href = remixAudio.src;
  } catch (err) {
    showProgress('Remix failed: ' + err.message);
  }
  remixBtn.disabled = false;
});

// Debug: allow playback on iOS (resume context)
document.addEventListener('touchstart', function () {
  if (audioCtx && audioCtx.state !== 'running') audioCtx.resume();
}, { passive: true });
