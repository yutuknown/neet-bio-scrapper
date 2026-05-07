# Publishing checklist

Before publishing a new snapshot:

1. Refresh chapter links: `npm run scrape:chapters`
2. Refresh PYQ links: `npm run scrape:pyq-links`
3. Regenerate chapter data: `npm run scrape:multi`
4. Re-run audits: `npm run audit`
5. Rebuild dashboard data: `npm run dashboard:build`
6. Serve and spot-check the dashboard: `npm run dashboard:serve`
7. Confirm `git status` only shows intentional source and data changes

Keep `.backup/` and `.debug/` out of the public workflow; they are reference-only workspace artifacts.