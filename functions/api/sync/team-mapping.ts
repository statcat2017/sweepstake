const dbToApi: Record<string, string> = {
  "Czechia": "Czech Republic",
  "Turkiye": "Turkey",
  "Ivory Coast": "Côte d'Ivoire",
  "Curacao": "Curaçao",
  "Cape Verde": "Cabo Verde",
  "Bosnia-Herzegovina": "Bosnia & Herzegovina",
};

const apiToDb: Record<string, string> = {};
for (const [db, api] of Object.entries(dbToApi)) {
  apiToDb[api] = db;
}

export function dbNameToApiName(dbName: string): string {
  return dbToApi[dbName] ?? dbName;
}

export function apiNameToDbName(apiName: string): string | null {
  const direct = apiToDb[apiName];
  if (direct) return direct;

  const normalized = apiName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  for (const [api, db] of Object.entries(apiToDb)) {
    if (api.normalize("NFKD").replace(/[\u0300-\u036f]/g, "") === normalized) {
      return db;
    }
  }

  return null;
}
