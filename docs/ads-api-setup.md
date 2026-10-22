# Amazon Ads API setup (AussieGifty, US)

You do the browser steps in SunBrowser Profile 831. The local script
`scripts/ads-auth.mjs` does the token exchange, profile lookup and `.env.ads`.

Rules: create only what is listed here, edit nothing else, click nothing that
costs money. Don't paste the client secret, auth code or tokens into chat.

Amazon's console screens change often. If a label below doesn't match what you
see, stop and describe the screen. Don't guess.

## A. Check the account (read only)

1. Open Profile 831 and go to https://advertising.amazon.com.
2. Check the account switcher (top right). It should show **AussieGifty** with
   marketplace **United States**. If it doesn't, stop.
3. Optional, for a truly read-only token: Settings → **User management**. If a
   user with a view-only role on AussieGifty exists, plan to do step D2 signed in
   as that user. Amazon has no read-only API scope; a token can do whatever the
   approving user can do.

## B. Look for an existing app (read only)

4. Go to https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html
   and sign in with the same Amazon account.
5. Write down any security profiles that are listed. For each one, open
   **Web Settings** and check whether it already has a Client ID.
6. Check whether this account already has **approved Amazon Ads API access**: an
   approval email from Amazon Ads, or an approved application in the Amazon Ads
   Partner Network / API console linked to one of those security profiles.
   - **Approved profile exists:** use it. Go to C2 (adding a return URL edits
     that profile; decide whether you're OK with that).
   - **None:** go to C1.

## C. Create or configure the security profile

C1. New profile (only if B found none):
   1. Click **Create a New Security Profile**.
   2. Name: `AussieGifty-Read-Only`. Description: `Internal reporting for AussieGifty`.
      Consent Privacy Notice URL: any privacy-policy URL you control (required field).
   3. Save. This is free.
   4. Apply for Amazon Ads API access and link this security profile to it
      (Amazon Ads API onboarding / Partner Network console). Choose the
      direct-advertiser / self-use option. Accept no paid plans. Approval takes
      roughly days, not minutes. **Stop here until you get the approval email.**

C2. Return URL:
   1. On the security profile, open **Web Settings** → **Edit**.
   2. Under **Allowed Return URLs**, add `http://localhost:3000/callback`.
      Leave existing entries as they are. Allowed Origins can stay empty.
   3. Save.
   4. Click **Show Secret**. Keep the Client ID and Client Secret on screen for
      step D1. Don't paste them anywhere else.

## D. Authorize (only after API access is approved)

D1. In the project folder, run in Terminal:

    node scripts/ads-auth.mjs authorize

   Enter the Client ID. Paste the Client Secret when asked; the prompt doesn't
   echo it. The script prints a long `https://www.amazon.com/ap/oa?...` URL.

D2. Copy that URL into **Profile 831**. Sign in as the ads user from step 3,
    or the main user if there is no view-only one.
    The consent screen should name your security profile. Check that, then
    click **Allow**.

D3. The browser goes to `localhost:3000/callback`.
   - If it shows "Authorization received", go back to Terminal.
   - If the page fails to load (the profile's proxy can block localhost), copy
     the full URL from the address bar and paste it into the Terminal prompt.

D4. If there are several US profiles, the script lists them; pick AussieGifty.
    The script then writes `.env.ads` (permissions 600, git-ignored) and
    runs a read-only profile check. Success means you see `HTTP 200` and the
    AussieGifty account name.

## E. Re-check any time

    node scripts/ads-auth.mjs verify

This refreshes the access token and makes one read-only GET of the profile. It
prints the status and the account details, never secrets.

## What this setup doesn't do

- It creates and edits no campaigns, budgets, bids or listings. The script sends
  only GET requests to the Ads API.
- It spends $0. A security profile and API access for your own use are free.
- If you click **Allow** as an admin user, the refresh token itself can make
  writes. Only our code keeps it read-only. Approve as a view-only user if you
  want Amazon to enforce read-only.
