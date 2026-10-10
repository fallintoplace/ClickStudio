import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const secret = () => randomBytes(32).toString('hex');
const data = `# Local-only credentials. Never commit this file.
HOST=127.0.0.1
CLICKSTUDIO_API_PORT=8080
APP_ORIGIN=http://localhost:5173
DATA_DIR=.data
CLICKSTUDIO_TOKEN=${secret()}
CLICKHOUSE_URL=http://127.0.0.1:8123
CLICKHOUSE_DATABASE=default
CLICKHOUSE_USER=clickstudio_reader
CLICKHOUSE_PASSWORD=${secret()}
CLICKHOUSE_WRITER_USER=clickstudio_writer
CLICKHOUSE_WRITER_PASSWORD=${secret()}
CLICKHOUSE_ADMIN_USER=clickstudio_admin
CLICKHOUSE_ADMIN_PASSWORD=${secret()}
DEMO_MODE=false
# Optional. Choose an account-supported Responses API model.
OPENAI_API_KEY=
OPENAI_MODEL=
AI_SENSITIVE_COLUMNS=password,token,secret,api_key
`;
try {
    writeFileSync('.env', data, { flag: 'wx', mode: 0o600 });
    console.log('Created private .env. Read CLICKSTUDIO_TOKEN from that file to sign in.');
} catch (error) {
    console.error(
        error.code === 'EEXIST'
            ? '.env already exists; it was not overwritten.'
            : 'Could not create .env.',
    );
    process.exitCode = 1;
}
