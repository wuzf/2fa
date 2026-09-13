These fixtures preserve the upgrade workflow and configuration merger from
`wuzf/2fa` commit `5cc1513`, before the Issue #18 compatibility fix.

Do not update them when changing the production workflow or merger. The regression
tests execute the frozen workflow's actual commit-and-push shell step against a
temporary Git remote that rejects workflow changes. The old merger demonstrates
the failure; the current merger must permit the same old workflow to upgrade.

The tests model rsync's file-copy/delete effects, then execute real Node and Git
commands locally. They do not contact GitHub or Cloudflare, so they cannot verify
Cloudflare's repository-triggered deployment or live Secrets storage.
