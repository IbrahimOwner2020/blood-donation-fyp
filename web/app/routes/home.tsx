import { redirect } from "react-router";

/** Entry redirects into the protected dashboard (or login via layout). */
export async function loader() {
  return redirect("/dashboard");
}
