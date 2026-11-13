import { loadEnvFile } from 'node:process';

/**
 * Load the variables of an env file into process.env.
 * Variables already set in the environment take precedence over the file ones.
 * Returns false when the file does not exist.
 */
export function loadEnv(path: string = '.env'): boolean {
    try {
        loadEnvFile(path);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

// Side effect on import: this module must be imported before any module reading process.env at load time
loadEnv();
