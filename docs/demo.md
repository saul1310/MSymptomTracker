# TA demo and presentation guide

## Before the demo

1. Install the selected model and fill in contributor attribution.
2. Run `npm run check` and `npm test` for the generator infrastructure.
3. Start Ollama and the generator. Confirm the UI reports the model as installed.
4. Try a real generation in advance. Check the downloaded application's behavior and run its generated tests. If the model fails, adjust the model or clarify requirements; do not present fixture-based infrastructure tests as proof of model quality.

## Live demonstration

1. Explain the two systems: the AI Coder is your submitted system; the tracker is its generated application.
2. Load the Medical Symptom Tracker example and discuss your group's concrete requirements.
3. Generate the project. Show the three stages and explain the MCP tool handoffs.
4. Show the API-call and input/output/total-token counts.
5. Inspect application and test source in the file viewer.
6. Download and extract the ZIP. Run `node server.mjs` in the extracted directory.
7. Open the generated application on port 3100; demonstrate logging, validation, editing/deletion, persistence, filtering, and trends according to the defined requirements.
8. Run `node --test tests/*.test.mjs`. Report the actual outcome, including any failures.
9. Open `generation-report.json` to show the per-agent usage and verification status.

## Presentation points

- Problem, selected software description, and defined requirements.
- Architecture and the sequence diagram in the README.
- Roles, model access, MCP server/client, structured handoffs, and sequential collaboration.
- Why the same local model can serve different agent roles.
- API/token accounting and observed real-generation results.
- Limitations: model quality, context/hardware demands, tests requiring manual execution, and no automatic repair.
- Each group member's actual contribution.
