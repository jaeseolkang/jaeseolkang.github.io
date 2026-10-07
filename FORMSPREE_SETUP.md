# Download Request Forms

The public site uses the existing Formspree form `mbgloaao` for all download/request forms.

- Form endpoint: `https://formspree.io/f/mbgloaao`
- Dashboard: `https://formspree.io/forms/mbgloaao/overview`

| Product | Public form page | `requestType` | Email subject |
| --- | --- | --- | --- |
| WorshipPPT Lite | `https://jaeseolkang.github.io/download.html` | `Lite 다운로드` | `예배PPT Lite 다운로드 신청` |
| 교회회계 (Church Accounting) | `https://jaeseolkang.github.io/curch_download.html` | `교회회계 앱` | `교회회계 앱 신청` |

Submissions are labeled with the `requestType` above and include the user's consent. Use the `requestType` field (or the email subject) in the Formspree Submissions view to tell the products apart.

In Formspree, check **Settings** for the notification recipient and **Submissions** for saved applications. Keep the endpoint ID in `download.html` and `curch_download.html`; never put account passwords or private API keys in this public repository.

## Church Accounting Form

- Page file: `curch_download.html`
- Consent value: `교회회계 앱 제공 및 도입 안내 수신`
- After a successful submission the page shows the app link set in the `APP_URL` constant at the top of the page script. If `APP_URL` is empty, it shows a message that the link will be sent by email instead.
- Related pages: `curch_index.html` (intro page), `curch_guide.html` (user guide).

## License Manager Sync

These forms currently save requests in Formspree and trigger its configured email notification. They do not write to the Firebase `licenses` collection or the license manager. Automatic sync needs a secured server-side webhook that stores applicants separately from issued licenses, followed by an authenticated admin view. Do not add direct public Firestore writes for applicant email addresses.
