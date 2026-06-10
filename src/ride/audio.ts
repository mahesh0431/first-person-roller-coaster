export class RideAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private rumble: GainNode | null = null;
  private chain: GainNode | null = null;
  private brake: GainNode | null = null;
  private enabled = true;

  async start() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    const context = new AudioCtor();
    const master = context.createGain();
    master.gain.value = 0.46;
    master.connect(context.destination);

    const wind = context.createGain();
    const rumble = context.createGain();
    const chain = context.createGain();
    const brake = context.createGain();
    wind.gain.value = 0;
    rumble.gain.value = 0;
    chain.gain.value = 0;
    brake.gain.value = 0;

    const windFilter = context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 820;
    windFilter.Q.value = 0.9;

    const brakeFilter = context.createBiquadFilter();
    brakeFilter.type = "highpass";
    brakeFilter.frequency.value = 1400;

    this.createNoiseSource(context).connect(windFilter).connect(wind).connect(master);
    this.createNoiseSource(context).connect(brakeFilter).connect(brake).connect(master);

    const rumbleOsc = context.createOscillator();
    rumbleOsc.type = "sawtooth";
    rumbleOsc.frequency.value = 44;
    const rumbleFilter = context.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 95;
    rumbleOsc.connect(rumbleFilter).connect(rumble).connect(master);
    rumbleOsc.start();

    const chainOsc = context.createOscillator();
    chainOsc.type = "square";
    chainOsc.frequency.value = 8;
    const chainFilter = context.createBiquadFilter();
    chainFilter.type = "bandpass";
    chainFilter.frequency.value = 380;
    chainFilter.Q.value = 4.2;
    chainOsc.connect(chainFilter).connect(chain).connect(master);
    chainOsc.start();

    this.context = context;
    this.master = master;
    this.wind = wind;
    this.rumble = rumble;
    this.chain = chain;
    this.brake = brake;
  }

  update(speed01: number, liftAmount: number, brakingAmount: number, intensity: number) {
    if (!this.context || !this.master || !this.wind || !this.rumble || !this.chain || !this.brake) return;

    const now = this.context.currentTime;
    const enabledGain = this.enabled ? 1 : 0;
    this.master.gain.setTargetAtTime(0.54 * enabledGain * intensity, now, 0.08);
    this.wind.gain.setTargetAtTime(Math.pow(speed01, 1.35) * 0.42, now, 0.08);
    this.rumble.gain.setTargetAtTime((0.04 + speed01 * 0.22) * enabledGain, now, 0.06);
    this.chain.gain.setTargetAtTime(liftAmount * 0.23 * enabledGain, now, 0.03);
    this.brake.gain.setTargetAtTime(brakingAmount * 0.18 * enabledGain, now, 0.025);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(enabled ? 0.45 : 0, this.context.currentTime, 0.08);
    }
  }

  dispose() {
    if (this.context) void this.context.close();
    this.context = null;
    this.master = null;
    this.wind = null;
    this.rumble = null;
    this.chain = null;
    this.brake = null;
  }

  private createNoiseSource(context: AudioContext) {
    const bufferSize = context.sampleRate * 2;
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    return source;
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
