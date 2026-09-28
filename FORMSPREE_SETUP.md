# Lite Download Form

The public site uses the existing Formspree form `mbgloaao`.

- Form endpoint: `https://formspree.io/f/mbgloaao`
- Dashboard: `https://formspree.io/forms/mbgloaao/overview`
- Public form page: `https://jaeseolkang.github.io/download.html`
- Submissions are labeled `requestType=Lite 다운로드` and include the user's consent.

In Formspree, check **Settings** for the notification recipient and **Submissions** for saved applications. Keep the endpoint ID in `download.html`; never put account passwords or private API keys in this public repository.

## License Manager Sync

This form currently saves requests in Formspree and triggers its configured email notification. It does not write to the Firebase `licenses` collection or the license manager. Automatic sync needs a secured server-side webhook that stores applicants separately from issued licenses, followed by an authenticated admin view. Do not add direct public Firestore writes for applicant email addresses.