# RHEO 1.1 — Fluid Instrument
## [Open the App](https://alirezasamari.github.io/RHEO-fluid-synth/dist/)
A browser synthesizer that turns measured spatial structure in a two-dimensional fluid into musical waveforms. Runs on its hosted HTTPS page or on localhost. It uses no audio samples, remote audio processing, or third-party JavaScript runtime libraries.

Project contact: [AlirezaSamari on GitHub](https://github.com/AlirezaSamari) · [alirexasamari@gmail.com](mailto:alirexasamari@gmail.com).

## Play

Enable audio, then Play demo, or use A S D F G H J K (white keys) and W E T Y U (black keys). Z/X change octave. Hold Space for sustain or click Sustain to latch it; Escape releases all notes and clears effect tails. Mouse, touch, and accessible button activation also play the on-screen keyboard.

Each note can inject a discrete vortex pair and a heat impulse, then listen through a closed pickup loop. “When you play” switches between **Excite fluid + listen** and **Listen to existing flow**. Listening-only notes do not force the fluid. Hold a note while stirring, heating, or cooling the field to hear the response.

- **Viscosity ν:** momentum diffusion. Smaller structures decay faster as viscosity increases.
- **Drag time τ:** exponential momentum decay; longer times retain flow history.
- **Vortex impulse / Heat per note:** sources applied only when a new note starts in excitation mode.
- **Buoyancy B:** temperature differences create vertical motion, relative to the spatial mean temperature.
- **Thermal diffusion κ:** spreads temperature gradients. Heat also cools toward zero with an 8-unit relaxation time.
- **Listen to:** tangential velocity, vorticity, or pressure sampled around a loop.
- **Probe motion:** Lagrangian loops follow the flow; Eulerian loops remain fixed in space.
- **Fluid voice:** blends the fluid waveform with a sine pitch anchor. At 100%, quiet or spatially uniform probe signals may produce little sound.
- Brightness, attack/release, stereo echo, diffuse reverb, and tempo shape the musical output.

Eight factory sounds include Glass current, Deep eddy, Silk drift, Vortex grain, Orbit bells, Pure flow, Thermal bloom, and Shear harmonics. Freeze holds evolution; note and pointer impulses can still change the field. Clear flow empties it and releases voices while retaining controls.

## Fluid Lab

The three experiments replace the flow, set a suitable listening configuration, remove effects and the pitch anchor, and switch notes to listening-only:

1. **Vortex pair:** opposite-sign vortices in a periodic domain. Compare lower and higher viscosity.
2. **Shear layer:** two periodic shear layers with a small velocity perturbation. Compare fixed and moving probes.
3. **Thermal plume:** a localized warm patch and its buoyant return flow. Compare buoyancy at zero and above zero; add Heat or Cool with the pointer.

The square canvas preserves the unit-square geometry. Field views display actual vorticity, gauge pressure, temperature, cell-centered speed, or passive dye with illustrative tracer streaks. Signed views use orange for positive and mint for negative values; color scales automatically rescale and display their range. Screen y points downward, so positive scalar vorticity appears clockwise.

Live diagnostics show box Reynolds number, kinetic energy, enstrophy, divergence RMS, Courant number, and Prandtl number. The probe plots inspect the newest held note, or the newest remaining release: the measured signal versus normalized arclength, and the voiced harmonic amplitudes after shaping, normalization and pitch anchor. Both plots automatically scale vertically. Circulation and loop length are reported separately.

## Equations and numerical meaning

Coordinates, velocities, pressure and temperature use dimensionless model units. L = 1 is the periodic box length, reference density is one, and e_y points down the screen. Between impulses the model is:

```
∂u/∂t + (u · ∇)u = −∇p + ν∇²u − u/τ − B(θ − mean(θ)) e_y
∇ · u = 0
∂θ/∂t + u · ∇θ = κ∇²θ − θ/8
```

Notes and pointer actions add separate momentum and temperature impulses. Subtracting mean temperature removes uniform buoyant acceleration of the periodic box. Thermal source accumulation is bounded to ±3 model units. This is a Boussinesq-type thermal model, not a calibrated model of a particular material.

The 48 × 48 staggered MAC grid uses midpoint RK2 semi-Lagrangian advection, explicit momentum/thermal diffusion, exponential drag and cooling, and conjugate-gradient pressure projection. Pressure uses a zero-mean gauge. CG targets a 10⁻⁶ relative residual with a 96-iteration cap; the actual post-projection divergence is shown. A periodic mean-momentum correction removes interpolation drift while retaining applied impulses and drag. No vorticity-confinement force adds artificial rotational energy.

The explicit diffusion stencil requires max(ν, κ) Δt N² ≤ 0.24. A bounded elapsed-time clock targets 120 steps/s with at most four catch-up steps; dropped steps and measured throughput are reported. Re_L = U_rms L/ν, E = ½ mean(u² + v²), Z = ½ mean(ω²), and Pr = ν/κ. Courant number uses max(|u| + |v|) Δt/Δx at cell centers. Re is a scale estimate, not a classifier or evidence that turbulence is resolved.

Every note has a 96-point loop. Moving loops use RK2 transport and periodic arclength remeshing; labels after remeshing are not permanent material particles. Uniform-arclength resampling forms q(s) = u·t, ω, or p. The loop mean is removed. Fixed synthesis gains (1, 0.085, 1/0.7 respectively), bounded normalization and a brightness-dependent taper map the signal into at most 32 harmonics. A 1024-sample table is refreshed at up to 30 Hz. The cutoff includes pitch-bend and vibrato headroom below 43% of audio sample rate. Circulation Γ = ∮u·dl is computed independently of the selected probe signal.

An AudioWorklet scans the spatial waveform at note frequency with continuous phase and approximately 12 ms timbre interpolation. Eight active voices, short voice-stealing tails, envelopes, MIDI pitch controls, stereo effects, DC blocking, smoothed gain and linked peak limiting complete the musical path.

**Interpretation:** this is sonification of approximate incompressible flow. Pressure enforces incompressibility; it is not an acoustic pressure wave. Note pitch and amplitude processing are musical choices. The coarse 2D grid has no free surface or 3D vortex stretching. Interpolation causes numerical diffusion and does not exactly conserve transported scalar integrals; finite projection tolerance and loop remeshing also introduce error. Static table harmonics are band-limited; time modulation and limiting are not guaranteed alias-free. This is not a converged scientific CFD solution or a VST/AU plug-in.

Methods informing the implementation:

- Jos Stam, *Stable Fluids* (1999): https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/ns.pdf
- Fedkiw, Stam & Jensen, *Visual Simulation of Smoke* (2001), for thermal buoyancy and pressure projection: https://graphics.stanford.edu/papers/smoke/smoke.pdf

## Sounds, recording and MIDI

Save sound stores up to 32 named parameter patches in this browser. An existing name replaces its settings. Export/import uses validated JSON. Last-used settings restore where browser storage is available. Legacy v1 patches import with no added heat and with the velocity probe. Patches contain parameters and octave, not the instantaneous flow or a recorded take. After restoring a listening-only patch, load an experiment or stir the field to supply motion.

Record captures the stereo synthesizer with effects as PCM16 WAV at the audio context's sample rate, for up to two minutes. The last three takes can be auditioned and downloaded; download before reloading or closing. The synth has no microphone or guitar capture path.

Connect MIDI requests permission where Web MIDI is supported. Note velocity, CC64 sustain, ±2 semitone bend, CC1 vibrato and CC120/123 release are supported per port/channel. MPE and external clock synchronization are outside this release. Keyboard/touch playback needs no MIDI permission. Engine status and Restart engine help recover while keeping settings.

## Local launch

Extract the source ZIP fully and run `python run_local.py`. On Windows use `py run_local.py` or double-click `Start-RHEO.bat`; on macOS/Linux use `python3 run_local.py`. Open http://localhost:8000 and keep the terminal running. Use `--port 8001` if needed. Ctrl+C stops the server. Opening HTML via `file://` does not support module workers and AudioWorklet.

