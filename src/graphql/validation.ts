import {
    GraphQLError,
    Kind,
    type ASTVisitor,
    type FragmentDefinitionNode,
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
