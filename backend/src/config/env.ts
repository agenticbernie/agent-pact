export interface AppConfig {
  llm: {
    baseURL: string;
    model: string;
    temperature: number;
    apiKey?: string;
  };
  solana: {
    network: string;
    rpcUrl: string;
    usdcMint: string;
  };
  dataDir: string;
  port: number;
}

export function getConfig(): AppConfig {
  return {
    llm: {
      baseURL: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
      model: process.env.LLM_MODEL || "nvidia/nemotron-3-super-120b-a12b:free",
      temperature: Number(process.env.LLM_TEMPERATURE ?? 0),
      apiKey: process.env.OPENROUTER_API_KEY || undefined,
    },
    solana: {
      network: process.env.SOLANA_NETWORK || "devnet",
      rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
      usdcMint: process.env.USDC_MINT || "4zMMC9srt5Ri5X14kAg4P8z6pS6vYspbbNs7AzpFpDmS",
    },
    dataDir: process.env.DATA_DIR || "./data",
    port: Number(process.env.PORT || 4000),
  };
}
