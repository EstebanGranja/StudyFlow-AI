"use client";

import { createClient } from "@insforge/sdk";

let client: ReturnType<typeof createClient> | null = null;

const ENV = {
  NEXT_PUBLIC_INSFORGE_BASE_URL: process.env.NEXT_PUBLIC_INSFORGE_BASE_URL,
  NEXT_PUBLIC_INSFORGE_ANON_KEY: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
} as const;

function getRequiredEnv(name: "NEXT_PUBLIC_INSFORGE_BASE_URL" | "NEXT_PUBLIC_INSFORGE_ANON_KEY") {
  const value = ENV[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function getInsforgeClient() {
  if (client) {
    return client;
  }

  client = createClient({
    baseUrl: getRequiredEnv("NEXT_PUBLIC_INSFORGE_BASE_URL"),
    anonKey: getRequiredEnv("NEXT_PUBLIC_INSFORGE_ANON_KEY"),
  });

  return client;
}
