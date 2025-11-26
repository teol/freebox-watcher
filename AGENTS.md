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
- Commit messages must be in english and follow the Conventional Commits specification
- Pull requests must include a **Summary** describing the changes and a **Testing** section listing the commands run.
- Provide line citations when referencing code or command output.

---

Thanks for contributing! 🙇‍♂️
