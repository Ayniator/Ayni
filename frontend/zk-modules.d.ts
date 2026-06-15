// Untyped ZK proving deps (used only in the browser, dynamically imported).
declare module "circomlibjs" {
  export function buildPoseidon(): Promise<any>;
}
declare module "snarkjs" {
  export const groth16: {
    fullProve(input: any, wasm: string, zkey: string): Promise<{ proof: any; publicSignals: string[] }>;
  };
}
