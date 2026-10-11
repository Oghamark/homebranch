# How to contribute

We welcome contributions to Homebranch. If you have an idea for a feature or have found a bug, open an issue to discuss it before beginning substantial work.

## Development

This repository is the integrated Homebranch workspace. It includes the API, web client, and authentication service as submodules.

1. [Fork](https://docs.github.com/get-started/quickstart/fork-a-repo) and clone the repository with its submodules:

   ```sh
   git clone --recurse-submodules https://github.com/Oghamark/homebranch.git
   cd homebranch
   ```

2. Add the upstream remote:

   ```sh
   git remote add upstream https://github.com/Oghamark/homebranch.git
   ```

3. Create a branch for your feature or bug fix:

   ```sh
   git switch -c my-feature-branch
   ```

4. Create a local environment file and start the development stack:

   ```sh
   cp .env.example .env
   docker compose -f docker-compose.dev.yml up
   ```

5. Make focused changes, follow the component's existing style, and run the checks relevant to the component you changed.

6. Commit with a descriptive message, push your branch, and open a pull request against this repository.

## Component changes

Changes to the source code within `homebranch-api`, `homebranch-web`, or `Authentication` belong to their respective component repositories. Submit the component change there first, then update this repository's submodule reference in a separate pull request once the component change is ready to integrate.

The component contribution guides link here for the shared issue process, integrated development environment, and project-wide pull request expectations.

## Contribution guidelines

- Comment on an existing issue before working on it.
- Include reproduction steps, screenshots, and relevant logs when reporting bugs.
- Describe the change and testing in every pull request.
- Write or update tests for behavior changes where practical.
- Keep documentation and configuration consistent with implementation changes.
- Do not commit secrets, generated local files, or unrelated formatting changes.

## License

By contributing, you agree that your contributions are licensed under the [GNU Affero General Public License v3.0](LICENSE).
