import { Auth0Client } from "@auth0/auth0-spa-js";

type Auth0BootstrapConfig = {
  enabled: boolean;
  domain?: string;
  clientId?: string;
  audience?: string;
};

let bootstrapConfig: Auth0BootstrapConfig | null = null;
let clientPromise: Promise<Auth0Client | null> | null = null;

export function setAuth0BootstrapConfig(config: Auth0BootstrapConfig | undefined): void {
  bootstrapConfig = config ?? null;
  clientPromise = null;
}

async function getClient(): Promise<Auth0Client | null> {
  if (!bootstrapConfig?.enabled || !bootstrapConfig.domain || !bootstrapConfig.clientId) {
    return null;
  }
  if (!clientPromise) {
    clientPromise = (async () => {
      const { domain, clientId, audience } = bootstrapConfig;
      if (!domain || !clientId) {
        return null;
      }
      const client = new Auth0Client({
        domain,
        clientId,
        authorizationParams: {
          audience,
          redirect_uri: window.location.href,
        },
        cacheLocation: "memory",
        useRefreshTokens: false,
      });
      const search = new URLSearchParams(window.location.search);
      if (search.get("code") && search.get("state")) {
        try {
          await client.handleRedirectCallback();
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("code");
          cleanUrl.searchParams.delete("state");
          cleanUrl.searchParams.delete("iss");
          window.history.replaceState({}, "", cleanUrl.toString());
        } catch {
          // Ignore redirect callback failures and fall back to silent auth.
        }
      }
      return client;
    })();
  }
  return clientPromise;
}

export async function getDelegatedJwt(): Promise<string | undefined> {
  const client = await getClient();
  if (!client || !bootstrapConfig?.audience) {
    return undefined;
  }
  try {
    return await client.getTokenSilently({
      authorizationParams: {
        audience: bootstrapConfig.audience,
      },
    });
  } catch {
    return undefined;
  }
}
