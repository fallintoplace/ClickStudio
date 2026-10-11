import type { ClickHouseDocumentationEntry } from '../../../shared/database/reference/types.js';
import type { Principal } from '../../../shared/common/identity.js';
import type { Schema } from '../../../shared/database/schema/types.js';
import { selectAssistantReferenceDocs } from '../../../shared/database/reference/catalog.js';
import type { Driver } from '../../app/types.js';

export async function assistantReferenceDocs(
    driver: Driver,
    p: Principal,
    connectionId: string,
    question: string,
    sql: string,
    schema: Schema,
    database: string,
): Promise<ClickHouseDocumentationEntry[]> {
    const candidates = selectAssistantReferenceDocs(question, sql, { schema, database });
    const nativeAvailable =
        driver.connection(p, connectionId).manifest?.documentation.available === true;
    return Promise.all(
        candidates.map(async candidate => {
            if (!nativeAvailable) return candidate;
            try {
                return (
                    (await driver.documentationEntry(
                        connectionId,
                        candidate.name,
                        candidate.type,
                    )) ?? candidate
                );
            } catch {
                return candidate;
            }
        }),
    );
}
