const YAHOO_FC_URL = 'https://fc.yahoo.com';
const YAHOO_CRUMB_URL = 'https://query1.finance.yahoo.com/v1/test/getcrumb';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface YahooSession {
  cookieHeader: string;
  crumb: string;
  createdAt: number;
}

let cachedSession: YahooSession | null = null;
let cachedSessionExpiresAt = 0;
let inFlightSession: Promise<YahooSession> | null = null;

const getSetCookieHeader = (response: Response): string => {
  const headers = response.headers as unknown as {
    raw?: () => Record<string, string[]>;
    getSetCookie?: () => string[];
  };

  let setCookie: string[] | undefined;

  if (typeof headers.getSetCookie === 'function') {
    setCookie = headers.getSetCookie();
  } else if (typeof headers.raw === 'function') {
    setCookie = headers.raw()['set-cookie'];
  } else {
    const single = response.headers.get('set-cookie');
    setCookie = single ? [single] : undefined;
  }

  if (!setCookie || setCookie.length === 0) {
    throw new Error('Yahoo session did not return any cookies');
  }

  return setCookie
    .map((cookie) => cookie.split(';')[0])
    .filter(Boolean)
    .join('; ');
};

const fetchYahooSession = async (): Promise<YahooSession> => {
  const fcResponse = await fetch(YAHOO_FC_URL, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      Referer: 'https://finance.yahoo.com/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-site',
      'Upgrade-Insecure-Requests': '1',
      Connection: 'keep-alive',
    },
  });

  const cookieHeader = getSetCookieHeader(fcResponse);

  if (!fcResponse.ok && fcResponse.status !== 404) {
    throw new Error(
      `Failed to initiate Yahoo session (${fcResponse.status} ${fcResponse.statusText})`,
    );
  }

  const crumbResponse = await fetch(YAHOO_CRUMB_URL, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      Referer: 'https://finance.yahoo.com/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      Cookie: cookieHeader,
      Connection: 'keep-alive',
    },
  });

  if (!crumbResponse.ok) {
    throw new Error(
      `Failed to fetch Yahoo crumb (${crumbResponse.status} ${crumbResponse.statusText})`,
    );
  }

  const crumb = (await crumbResponse.text()).trim();

  if (!crumb) {
    throw new Error('Received empty crumb from Yahoo');
  }

  return {
    cookieHeader,
    crumb,
    createdAt: Date.now(),
  };
};

export async function getYahooSession(options?: {
  forceRefresh?: boolean;
}): Promise<YahooSession> {
  const forceRefresh = options?.forceRefresh ?? false;

  if (!forceRefresh && cachedSession && Date.now() < cachedSessionExpiresAt) {
    return cachedSession;
  }

  if (!inFlightSession) {
    inFlightSession = fetchYahooSession()
      .then((session) => {
        cachedSession = session;
        cachedSessionExpiresAt = Date.now() + SESSION_TTL_MS;
        return session;
      })
      .finally(() => {
        inFlightSession = null;
      });
  }

  const session = await inFlightSession;

  if (forceRefresh) {
    cachedSession = session;
    cachedSessionExpiresAt = Date.now() + SESSION_TTL_MS;
  }

  return session;
}

export function invalidateYahooSession(): void {
  cachedSession = null;
  cachedSessionExpiresAt = 0;
}
