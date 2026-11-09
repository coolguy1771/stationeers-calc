/**
 * IR layer (EXT-01): the intermediate representation that the normalizer
 * produces from raw records. Versioned via `IR_VERSION`; the normalizer
 * emits a `IrData` carrying `irVersion: IR_VERSION`.
 */
export * from './provenance';
export * from './records';
export * from './raw';
