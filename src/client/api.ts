import type { ProviderCapability, ValidationInput, ValidationResult } from "../core/types";

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly issues: ApiIssue[];

  constructor(message: string, status: number, issues: ApiIssue[] = []) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.issues = issues;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | T
    | { error?: string; message?: string; issues?: ApiIssue[] }
    | null;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && ("message" in body || "error" in body)
        ? body.message ?? body.error
        : undefined;
    const issues =
      body && typeof body === "object" && "issues" in body && Array.isArray(body.issues)
        ? body.issues.filter(
            (issue): issue is ApiIssue =>
              Boolean(issue) &&
              typeof issue === "object" &&
              typeof issue.path === "string" &&
              typeof issue.message === "string"
          )
        : [];
    throw new ApiRequestError(message || `请求失败（${response.status}）`, response.status, issues);
  }
  return body as T;
}

export async function getProviderCapabilities(): Promise<ProviderCapability[]> {
  const response = await fetch("/api/providers", { headers: { Accept: "application/json" } });
  const body = await readJson<ProviderCapability[] | { providers: ProviderCapability[] }>(response);
  return Array.isArray(body) ? body : body.providers;
}

export async function createValidationRun(input: ValidationInput): Promise<ValidationResult> {
  const response = await fetch("/api/validation-runs", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return readJson<ValidationResult>(response);
}
