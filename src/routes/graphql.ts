import { type FastifyBaseLogger, type FastifyPluginAsync } from 'fastify';
import {
    execute,
    GraphQLError,
    NoSchemaIntrospectionCustomRule,
    parse,
    specifiedRules,
    validate,
    type DocumentNode,
    type GraphQLFormattedError,
    type GraphQLSchema,
} from 'graphql';
import { createBearerAuth } from '../middleware/bearerAuth.js';
import { createMaxRootFieldsRule } from '../graphql/validation.js';

/**
 * Maximum request body size in bytes
 */
const MAX_BODY_SIZE = 16 * 1024;

/**
 * Maximum length of the GraphQL query string
 */
const MAX_QUERY_LENGTH = 8000;

/**
 * Maximum number of lexical tokens in a GraphQL document (bounds parsing cost)
 */
const MAX_TOKENS = 1000;

/**
 * Maximum number of root fields per operation (bounds the number of database queries)
 */
const MAX_ROOT_FIELDS = 10;

/**
 * Maximum number of validation errors reported for a single document
 */
const MAX_VALIDATION_ERRORS = 10;

export interface GraphqlRouteOptions {
    /** Read-only GraphQL schema to serve */
    schema: GraphQLSchema;
    /** SHA-256 digest of the Bearer token allowed to query the API */
    tokenHash: Buffer;
    /** Maximum number of requests per minute on the GraphQL endpoint */
    rateLimitMax: number;
}

interface GraphqlRequestBody {
    query: string;
    variables?: Record<string, unknown> | null;
    operationName?: string | null;
}

/**
 * Formats an error for the client, masking unexpected (non-GraphQL) errors
 * so that internal details (SQL errors, stack traces) are never exposed
 */
function formatError(error: GraphQLError, logger: FastifyBaseLogger): GraphQLFormattedError {
    if (error.originalError && !(error.originalError instanceof GraphQLError)) {
        logger.error({ err: error.originalError, path: error.path }, 'GraphQL resolver failed');
        return {
            message: 'Internal server error',
            ...(error.locations ? { locations: error.locations } : {}),
            ...(error.path ? { path: error.path } : {}),
        };
    }

    return {
        message: error.message,
        ...(error.locations ? { locations: error.locations } : {}),
        ...(error.path ? { path: error.path } : {}),
    };
}

/**
 * Read-only GraphQL API routes
 */
export const graphqlRoutes: FastifyPluginAsync<GraphqlRouteOptions> = async (
    fastify,
    options
): Promise<void> => {
    const { schema, tokenHash, rateLimitMax } = options;
    const bearerAuth = createBearerAuth(tokenHash);
    const validationRules = [
        ...specifiedRules,
        NoSchemaIntrospectionCustomRule,
        createMaxRootFieldsRule(MAX_ROOT_FIELDS),
    ];

    /**
     * POST /graphql
     * Execute a read-only GraphQL query
     */
    fastify.post<{ Body: GraphqlRequestBody }>(
        '/graphql',
        {
            // Runs after the rate limiter (onRequest) and before the body is parsed
            preParsing: bearerAuth,
            bodyLimit: MAX_BODY_SIZE,
            config: {
                rateLimit: {
                    max: rateLimitMax,
                    timeWindow: '1 minute',
                },
            },
            schema: {
                body: {
                    type: 'object',
                    required: ['query'],
                    properties: {
                        query: { type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH },
                        variables: { type: ['object', 'null'] },
                        operationName: { type: ['string', 'null'], maxLength: 100 },
                    },
                    additionalProperties: false,
                },
            },
        },
        async (request, reply) => {
            void reply.header('Cache-Control', 'no-store');

            const { query, variables, operationName } = request.body;

            let document: DocumentNode;
            try {
                document = parse(query, { maxTokens: MAX_TOKENS });
            } catch (error) {
                const message =
                    error instanceof GraphQLError ? error.message : 'Invalid GraphQL document';
                return reply.code(400).send({ errors: [{ message }] });
            }

            const validationErrors = validate(schema, document, validationRules, {
                hideSuggestions: true,
                maxErrors: MAX_VALIDATION_ERRORS,
            });
            if (validationErrors.length > 0) {
                return reply.code(400).send({
                    errors: validationErrors.map((error) => formatError(error, request.log)),
                });
            }

            const result = await execute({
                schema,
                document,
                variableValues: variables,
                operationName,
                hideSuggestions: true,
            });

            const errors = result.errors?.map((error) => formatError(error, request.log));

            // No data means the request itself was invalid (e.g. bad variables, unknown operation)
            if (result.data === undefined) {
                return reply.code(400).send({ errors });
            }

            return reply.code(200).send({
                data: result.data,
                ...(errors ? { errors } : {}),
            });
        }
    );
};
