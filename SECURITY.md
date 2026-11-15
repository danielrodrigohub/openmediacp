# Security baseline

This is an initial self-hosted release, not an OWASP/ASVS certification or a guarantee of zero vulnerabilities.

Implemented controls:

- No default administrator or public registration. Bootstrap/reset from the VPS console, password through stdin.
- Passwords: scrypt N=131072, r=8, p=1, unique 128-bit salt, 64-byte output, constant-time comparison. Minimum 15, maximum 128 Unicode characters. A small common-password denylist is included; it is not a complete breached-password database.
- Server-side SQLite sessions. Random 256-bit bearer cookies; only their SHA-256 digests are stored. HttpOnly, SameSite=Strict, Secure and __Host- prefix on HTTPS. Eight-hour absolute and 30-minute idle expiry. Logout and password change revoke sessions.
- Persistent account and source-address login throttles; concurrent password checks limited. Generic login errors; change-password throttling.
- Origin verification on mutations (including login), role checks and channel/asset ownership checks. SQL parameters; no caller-provided commands or media source URLs.
- Ingest secrets are generated, shown once and stored only as hashes. Signed OME admission requests, constant-time signature check and timestamp bound. Engine control ports are not published. Public proxy blocks the internal webhook and blocks direct playback of input streams.
- Self-hosted fonts and player libraries. CSP limits scripts to the application plus one explicitly hashed theme initializer. Frame protection, nosniff, no-referrer and HSTS on HTTPS.
- Uploads: 128 MB input, two processing jobs maximum per application instance, limited file protocols, timeout, generated filenames, actual MP4/video/audio inspection and normalization, configurable per-owner media quota (5 GB by default on VPS). FFmpeg runs as the unprivileged app user in production. Videos are not served as executable content.
- Application container: non-root, read-only image, no extra Linux capabilities, resource limits, no Docker socket. Persistent data volume contains private database and shared read-only media/schedule mounts for OME.

Scope and operational limits:

- Playback is public by design. Private/paywalled playback and geo restrictions are not implemented.
- RTMP ingest is not encrypted. Restrict TCP 1935 to encoder IPs in the provider firewall or use a trusted private network/VPN. HTTPS protects panel credentials and viewer traffic; it does not encrypt RTMP.
- Cloudflare Origin CA mode requires Full (strict), a certificate covering both panel/media domains and periodic certificate renewal. Flexible SSL is unsupported. Cloudflare DNS-only is required for the ingest hostname. The built-in proxy throttling sees Cloudflare edge addresses in proxied mode; it does not trust arbitrary CF-Connecting-IP headers.
- MFA, a complete breached-password list, self-service recovery, fine-grained quotas, automated retention and multi-node coordination are not implemented. This release targets one app process on one VPS. Protect the superadministrator with a unique password and optionally an external identity/access layer.
- Session cleanup is performed at login; expired sessions cannot authenticate. Audit events contain no passwords, tokens or publish URLs. Rotate/back up audit data as part of operations.
- A key rotation prevents new publications using the old key. It does not disconnect an already connected encoder; stop that encoder first.

## Dependency and CVE handling

`npm run security:audit` checks the locked npm dependency tree. The image build also runs it. `scripts/security-scan.sh` scans the application image plus the derived OME image and exact Caddy digest with Trivy and fails for HIGH/CRITICAL findings, including unfixed findings. The installer runs that gate before bringing up the stack. Reports stay in `reports/` and are not packaged.

Digest pinning ensures reproducibility; it does not update security fixes automatically. Review vendor advisories, update lockfiles and image digests, rerun checks and scans, then deploy. Re-scan after vulnerability database updates. OS/Docker packages need regular host updates too. Never label an image secure solely because a scan passed.

References: [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

The local Mac bootstrap may display initial random credentials. A private `.local-access` handoff note was created during setup; it is excluded from source control, builds and release archives and should be deleted after changing the initial password/key. This note is not created by the VPS installer.

In 0.3, directory paths are validated metadata only; actual files use generated IDs. PNG uploads are decoded and re-encoded with size/dimension and concurrency limits. The compositor and AutoDJ worker run as the same non-root image with isolated resource limits. Internal publication keys are HMACs of stream names; only signed OME admission calls can submit them. Client publish keys cannot publish the compositor output or the AutoDJ stream.
