# Third-party files served as they are

Loaded only when someone turns a recording of chords into notes (*Turn an audio recording into
notes… → Chords or several notes at once*), by `src/audio/basicPitch.ts`. Both are under the
Apache License 2.0 (the `LICENSE` file in each folder).

| Folder | What | From | Checked |
|---|---|---|---|
| `tfjs/tf.es2017.min.js` | TensorFlow.js 3.21.0, browser bundle for modern browsers (`dist/tf.es2017.min.js`; the source-map comment removed). Not `tf.min.js`: its bundled polyfills run code from strings, which the app's Content-Security-Policy forbids. Copyright Google LLC | npm `@tensorflow/tfjs@3.21.0` | registry sha512 `khcARd3/872llL/oF4ouR40qlT71mylU66PGT8kHP/GJ5YKj44sv8lDRjU7lOVlJK7jsJFWEsNVHI3eMc/GWNQ==` |
| `basic-pitch/model.json`, `group1-shard1of1.bin` | Basic Pitch, Spotify's model that hears notes (several at once) in audio. Copyright 2022 Spotify AB | npm `@spotify/basic-pitch@1.0.1` (`model/`) | registry sha512 `SAxiFi9ZnyhGdhWEOS9YVhdunZiKzI3I5zOccZzDzQRr4s00Ii9lphqlPMMfby3iYa7TSupB2g8yuu1kJ6gL+Q==` |

The code that runs the model and turns its output into notes is ported from Basic Pitch's
`src/inference.ts` and `src/toMidi.ts` into `src/audio/basicPitch.ts` (with its copyright notice).

To update: download the npm packages, compare their sha512 with the registry's `dist.integrity`,
and copy the same files here.
