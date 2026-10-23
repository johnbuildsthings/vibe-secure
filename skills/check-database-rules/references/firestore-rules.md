# Firebase security rules

Ready-to-adapt rules for `check-database-rules` fixes. Replace collection and field names with the real ones. Firebase rules deny everything that no rule allows, so the safest shape is: one owner-only rule per collection, and no catch-all `{document=**}` rule that allows anything.

## Firestore: owner-only documents keyed by user id

For a collection where each document's id is the user's uid (`/accounts/{uid}`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isOwner(uid) { return signedIn() && request.auth.uid == uid; }
    // Fields only the server (Admin SDK) may set.
    function touchesPrivilegeFields() {
      return request.resource.data.diff(resource == null ? {} : resource.data)
        .affectedKeys().hasAny(['role', 'isAdmin', 'plan', 'credits']);
    }

    match /accounts/{uid} {
      allow read: if isOwner(uid);
      allow create, update: if isOwner(uid) && !touchesPrivilegeFields();
      allow delete: if isOwner(uid);
    }

    // No catch-all rule: every other path is denied.
  }
}
```

## Firestore: documents with an owner field

For a collection whose documents store the owner (`/orders/{orderId}` with `ownerId`):

```
match /orders/{orderId} {
  allow read, delete: if request.auth != null && resource.data.ownerId == request.auth.uid;
  allow create: if request.auth != null && request.resource.data.ownerId == request.auth.uid;
  allow update: if request.auth != null
    && resource.data.ownerId == request.auth.uid
    && request.resource.data.ownerId == request.auth.uid;
}
```

Queries must match the rule: a browser query `getDocs(collection(db, 'orders'))` is rejected; `query(collection(db, 'orders'), where('ownerId', '==', user.uid))` works.

## Firestore: public read, owner write

```
match /posts/{postId} {
  allow read: if true;
  allow create: if request.auth != null && request.resource.data.authorId == request.auth.uid;
  allow update, delete: if request.auth != null && resource.data.authorId == request.auth.uid;
}
```

Only for content meant for everyone, with no private fields in the document.

## Admin access

Don't trust a `role` field the user can write. Give admins a custom claim from the server with the Admin SDK (`admin.auth().setCustomUserClaims(uid, { admin: true })`), and check it in rules:

```
function isAdmin() { return request.auth != null && request.auth.token.admin == true; }

match /accounts/{uid} {
  allow read: if isOwner(uid) || isAdmin();
}
```

## Storage (`storage.rules`)

Files under a per-user folder, readable and writable only by that user, with a size and type limit:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /uploads/{uid}/{fileName} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if request.auth != null && request.auth.uid == uid
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }
  }
}
```

## Realtime Database (`database.rules.json`)

```json
{
  "rules": {
    "accounts": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

## What may break

- Browser code that lists a whole collection (`getDocs(collection(db, '<c>'))`), such as admin screens, is rejected. Move admin lists to a Cloud Function that checks the admin claim, or add an `isAdmin()` rule.
- Writes that don't set the owner field, or that include a privilege field such as `role`, are rejected. Forms must send only the editable fields.
- Anything that relied on test-mode rules stops working until it matches a real rule.

## Applying a fix

1. Edit the rules file named in `firebase.json` (`firestore.rules`, `storage.rules`).
2. Deploy it: `firebase deploy --only firestore:rules,storage`, or open the Firebase console → **Firestore Database → Rules** (and **Storage → Rules**), paste, and click **Publish**.
3. Test it in the console's **Rules Playground**: a read of another user's document should say "Denied".

## Console checklist

Use these as `manual_steps` for `db.write-unverified` (the rules live only in the console, so the code can't show them):

1. Open console.firebase.google.com and choose your project.
2. Go to **Firestore Database → Rules**. Check that no rule says `if true`, that there is no `request.time < timestamp.date(…)` test-mode rule, and that there is no `match /{document=**}` rule allowing reads or writes.
3. Check that each collection with user data compares the document's owner to `request.auth.uid`, not just `request.auth != null`.
4. Check that users can't write fields such as `role`, `isAdmin` or `plan` on their own documents.
5. Go to **Storage → Rules** and check the same things for files.
6. If you use the Realtime Database, go to **Realtime Database → Rules** and check that `.read` and `.write` aren't `true` or just `auth != null`.
7. Optional but recommended: run `firebase init firestore` (and `storage`) to save the rules into your project, so the next audit can check them.
