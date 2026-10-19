<img width="1647" height="973" alt="start_dashboard" src="https://github.com/user-attachments/assets/e7ac197f-78c0-457b-bf82-b7b960ef0899" />
# Opportunity Desk

Qualify every sales lead by solution fit, value and risk, in one view shared by sales, presales and leadership.

- **Executive view**: fit-vs-value quadrant, stage funnel and deal-size chart that filter the lead list, plus a status card per lead.
- **Operational view**: ranked queue with the full assessment (product fit, value, stakeholders, risks) and tasks grouped by workstream.
- **Draft with Claude**: paste an RFP or client email and get a filled-in assessment to review.

A simpler kanban "deal tracker" UI was built and set aside; it is kept in `archive/deal-tracker-ui/` (see CLAUDE.md).

## Getting started

Requires Node.js 20 or later.

```bash
npm install
cp .env.example .env    # then put your Anthropic API key in .env
npm start
```

Open http://localhost:3000. The database (`data/opportunity-desk.db`) is created on first run and loaded with six example deals and five products. Delete them in the app once real data is in, or run `npm run seed` to reset.

Without an API key everything works except AI drafting.

## Working on it with Claude Code

```bash
cd opportunity-desk
claude
```

`CLAUDE.md` describes the architecture, data model and conventions, so Claude Code picks up the context automatically. Good first tasks: replace the example products with the real catalog in `seed/products.json`, add authentication, or make scoring weights configurable.

## Security note

There is no login yet. Run it locally or on a trusted network only until authentication is added.
