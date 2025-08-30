import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { mintS2S } from "./s2s";

/** The ONLY client the gateway may use to call internal workers. */
export const s2sClient = axios.create();

s2sClient.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(cfg.headers);
  // Never forward any user token; always inject fresh S2S
  headers.delete("Authorization");
  headers.set("Authorization", `Bearer ${mintS2S("gateway")}`);
  cfg.headers = headers;
  return cfg;
});
