# AI Contribution Guidelines

Welcome, 🤖 AI assistant! Please follow these guidelines when contributing to this repository:

## Code Guidelines

- Use modern JavaScript ES6+ syntax and features
- Use four-space indent; semicolons required
- Follow naming conventions: camelCase for variables/functions
- Follow secure coding practices to prevent common web vulnerabilities (XSS, CSRF, injections, auth bypass, open redirects, etc.)
- Add code comments only for complex or unintuitive code
- Do not remove already existing code comments except if they are outdated, incorrect, or if you're deleting the code it refers to
- Error messages must be concise but very precise
- Wrap strings with single straight quotes
- Respect the existing code style unless instructed otherwise.
- Use English in code, comments, commit messages and branch names

## Commits Guidelines

- If a test script is available, run `npm test` before submitting a contribution.
- Format modified JavaScript files with `npx prettier -w` (four-space indent; semicolons required).
- Commit messages and PR titles must be in English and follow the [Conventional Commits specification](https://www.conventionalcommits.org/en/v1.0.0/)
- Pull requests must include a **Summary** describing the changes and a **Testing** section listing the commands run.
- Provide line citations when referencing code or command output.

### Conventional Commits Format

Commit messages must follow this structure:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Common types:**

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `build`: Changes that affect the build system or external dependencies
- `ci`: Changes to CI configuration files and scripts
- `chore`: Other changes that don't modify src or test files

**Examples:**

```
feat: add heartbeat monitoring endpoint
fix: resolve database connection timeout
docs: update installation instructions
refactor: simplify authentication middleware
test: add unit tests for downtime service
```

---

Thanks for contributing! 🙇‍♂️
