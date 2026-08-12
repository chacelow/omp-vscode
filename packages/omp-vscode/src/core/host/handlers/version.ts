import type { Handler } from "./index";
import { getOmpCliVersion } from "../omp-cli";

export const versionHandler: Handler<"version"> = async (_params, service) => ({
  pi: "",
  omp: service.deps.extensionVersion,
  cli: await getOmpCliVersion(),
});
