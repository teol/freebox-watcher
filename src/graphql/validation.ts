import {
    getArgumentValues,
    getNamedType,
    getNullableType,
    getVariableValues,
    GraphQLError,
    isCompositeType,
    isInterfaceType,
    isListType,
    isObjectType,
    Kind,
    type ASTVisitor,
    type DocumentNode,
    type FieldNode,
    type FragmentDefinitionNode,
    type GraphQLCompositeType,
    type GraphQLField,
    type GraphQLSchema,
    type OperationDefinitionNode,
    type SelectionSetNode,
    type ValidationContext,
    type ValidationRule,
} from 'graphql';

/**
 * Counts the root fields selected by a selection set, expanding fragments
 * Fragments already visited are skipped (cycles are reported by the NoFragmentCycles rule)
 */
function countRootFields(
    selectionSet: SelectionSetNode,
    fragments: Map<string, FragmentDefinitionNode>,
    visitedFragments: Set<string>
): number {
    let count = 0;

    for (const selection of selectionSet.selections) {
        switch (selection.kind) {
            case Kind.FIELD:
                // Meta fields such as __typename do not hit the database
                if (!selection.name.value.startsWith('__')) {
                    count++;
                }
                break;
            case Kind.INLINE_FRAGMENT:
                count += countRootFields(selection.selectionSet, fragments, visitedFragments);
                break;
            case Kind.FRAGMENT_SPREAD: {
                const fragmentName = selection.name.value;
                const fragment = fragments.get(fragmentName);

                if (fragment && !visitedFragments.has(fragmentName)) {
                    visitedFragments.add(fragmentName);
                    count += countRootFields(fragment.selectionSet, fragments, visitedFragments);
                }
                break;
            }
        }
    }

    return count;
}

/**
 * Creates a validation rule limiting the number of root fields per operation
 * Each root field triggers at least one database query, so this bounds the cost of a
 * single request (e.g. many aliased copies of the same paginated field).
 * @param maxRootFields Maximum number of root fields allowed per operation
 * @returns A GraphQL validation rule
 */
export function createMaxRootFieldsRule(maxRootFields: number): ValidationRule {
    return (context: ValidationContext): ASTVisitor => {
        const fragments = new Map<string, FragmentDefinitionNode>();

        for (const definition of context.getDocument().definitions) {
            if (definition.kind === Kind.FRAGMENT_DEFINITION) {
                fragments.set(definition.name.value, definition);
            }
        }

        return {
            OperationDefinition(node): void {
                const rootFieldCount = countRootFields(node.selectionSet, fragments, new Set());

                if (rootFieldCount > maxRootFields) {
                    context.reportError(
                        new GraphQLError(
                            `Operation selects ${rootFieldCount} root fields, maximum allowed is ${maxRootFields}`,
                            { nodes: node }
                        )
                    );
                }
            },
        };
    };
}

/**
 * Estimates the number of fields an operation will return, expanding aliases, fragments
 * and list cardinality (taken from the `limit` argument, including when set through variables)
 * Every selection counts, so reusing a fragment or aliasing a field multiplies its cost.
 * The document must already have passed validation (fragment cycles are not reported here).
 * @param schema The GraphQL schema
 * @param document The parsed GraphQL document
 * @param operationName Name of the operation to run, if the document defines several
 * @param variables Raw variable values supplied by the client
 * @param maxListSize Assumed size of a list field whose `limit` is not a number
 * @returns The estimated cost, or 0 if the operation or its variables cannot be resolved
 * (execution then reports the error itself)
 */
export function estimateOperationCost(
    schema: GraphQLSchema,
    document: DocumentNode,
    operationName: string | null | undefined,
    variables: Record<string, unknown> | null | undefined,
    maxListSize: number
): number {
    const fragments = new Map<string, FragmentDefinitionNode>();
    const operations: OperationDefinitionNode[] = [];

    for (const definition of document.definitions) {
        if (definition.kind === Kind.FRAGMENT_DEFINITION) {
            fragments.set(definition.name.value, definition);
        } else if (definition.kind === Kind.OPERATION_DEFINITION) {
            operations.push(definition);
        }
    }

    const operation = operationName
        ? operations.find((candidate) => candidate.name?.value === operationName)
        : operations.length === 1
          ? operations[0]
          : undefined;
    const rootType = schema.getQueryType();
    if (!operation || !rootType) {
        return 0;
    }

    const coercion = getVariableValues(
        schema,
        operation.variableDefinitions ?? [],
        variables ?? {}
    );
    if (coercion.errors) {
        return 0;
    }
    const variableValues = coercion.variableValues;

    // A fragment always has the same cost whatever the place it is spread at
    const fragmentCosts = new Map<string, number>();

    const listSize = (fieldDef: GraphQLField<unknown, unknown>, field: FieldNode): number => {
        try {
            const limit = getArgumentValues(fieldDef, field, variableValues).limit;
            return typeof limit === 'number' && limit >= 1 ? limit : maxListSize;
        } catch {
            return maxListSize;
        }
    };

    const selectionSetCost = (
        parentType: GraphQLCompositeType,
        selectionSet: SelectionSetNode
    ): number => {
        let cost = 0;

        for (const selection of selectionSet.selections) {
            switch (selection.kind) {
                case Kind.FIELD: {
                    if (selection.name.value.startsWith('__')) {
                        break;
                    }

                    cost++;

                    const fieldDef =
                        isObjectType(parentType) || isInterfaceType(parentType)
                            ? parentType.getFields()[selection.name.value]
                            : undefined;
                    const fieldType = fieldDef ? getNamedType(fieldDef.type) : undefined;

                    if (fieldDef && selection.selectionSet && isCompositeType(fieldType)) {
                        const multiplier = isListType(getNullableType(fieldDef.type))
                            ? listSize(fieldDef, selection)
                            : 1;
                        cost += multiplier * selectionSetCost(fieldType, selection.selectionSet);
                    }
                    break;
                }
                case Kind.INLINE_FRAGMENT: {
                    const conditionType = selection.typeCondition
                        ? schema.getType(selection.typeCondition.name.value)
                        : parentType;

                    if (isCompositeType(conditionType)) {
                        cost += selectionSetCost(conditionType, selection.selectionSet);
                    }
                    break;
                }
                case Kind.FRAGMENT_SPREAD: {
                    const fragmentName = selection.name.value;
                    const fragment = fragments.get(fragmentName);
                    if (!fragment) {
                        break;
                    }

                    let fragmentCost = fragmentCosts.get(fragmentName);
                    if (fragmentCost === undefined) {
                        // Set before the recursion so that an unexpected cycle terminates
                        fragmentCosts.set(fragmentName, 0);
                        const conditionType = schema.getType(fragment.typeCondition.name.value);
                        fragmentCost = isCompositeType(conditionType)
                            ? selectionSetCost(conditionType, fragment.selectionSet)
                            : 0;
                        fragmentCosts.set(fragmentName, fragmentCost);
                    }
                    cost += fragmentCost;
                    break;
                }
            }
        }

        return cost;
    };

    return selectionSetCost(rootType, operation.selectionSet);
}
