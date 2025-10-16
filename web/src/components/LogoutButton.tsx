import LogoutButton from "./LogoutButton";

// ...
if (authed) {
  return (
    <div className="flex items-center gap-2">
      {/* Optional: show who’s signed in */}
      {/* <span className="text-sm text-muted-foreground">{userEmail}</span> */}
      <a className="btn btn-light" href="/welcome">Welcome</a>
      <LogoutButton />
    </div>
  );
}
