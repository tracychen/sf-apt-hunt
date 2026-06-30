# Facebook Extension Manual Test

- [ ] `npm run dev` is running on `http://localhost:3333`.
- [ ] `.env.local` contains `EXTENSION_ALLOWED_IDS=<loaded extension id>`.
- [ ] The extension is loaded unpacked from `extension/`.
- [ ] Extension popup shows disconnected state.
- [ ] `Connect Apt Hunt` opens `/extension/connect?extensionId=<id>`.
- [ ] Signed-in connect succeeds and popup shows the account email.
- [ ] A Facebook group can be added to the allowlist.
- [ ] A fixture/group post receives `Save to Apt Hunt`.
- [ ] Save reviewed returns `Saved`.
- [ ] The listing appears in the app listing ledger after refresh.
- [ ] Popup disconnect revokes the token; a subsequent import fails until reconnect.
