import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadEnv } from '../src/utils/loadEnv.js';

describe('loadEnv', () => {
    let tempDir: string;

    before(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freebox-watcher-env-'));
    });

    after(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    afterEach(() => {
        delete process.env.LOAD_ENV_TEST_NEW;
        delete process.env.LOAD_ENV_TEST_EXISTING;
        delete process.env.LOAD_ENV_TEST_QUOTED;
    });

    it('should load variables from the file', async () => {
        const envPath = path.join(tempDir, 'load.env');
        await fs.writeFile(
            envPath,
            '# comment\nLOAD_ENV_TEST_NEW=value\nLOAD_ENV_TEST_QUOTED="with # hash"\n'
        );

        assert.strictEqual(loadEnv(envPath), true);
        assert.strictEqual(process.env.LOAD_ENV_TEST_NEW, 'value');
        assert.strictEqual(process.env.LOAD_ENV_TEST_QUOTED, 'with # hash');
    });

    it('should not override variables already set in the environment', async () => {
        const envPath = path.join(tempDir, 'override.env');
        await fs.writeFile(envPath, 'LOAD_ENV_TEST_EXISTING=from-file\n');
        process.env.LOAD_ENV_TEST_EXISTING = 'from-environment';

        loadEnv(envPath);

        assert.strictEqual(process.env.LOAD_ENV_TEST_EXISTING, 'from-environment');
    });

    it('should return false when the file does not exist', () => {
        assert.strictEqual(loadEnv(path.join(tempDir, 'missing.env')), false);
    });

    it('should rethrow errors other than a missing file', () => {
        assert.throws(
            () => loadEnv(tempDir),
            (error: NodeJS.ErrnoException) => error.code !== 'ENOENT'
        );
    });
});
