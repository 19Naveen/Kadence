import { useState } from "react";
import { PasswordField } from "kadence";

export const SignIn = () => {
  const [value, setValue] = useState("");
  return (
    <div style={{ width: 360, padding: 24 }}>
      <PasswordField id="password" label="Password" value={value} onChange={setValue} autoComplete="current-password" />
    </div>
  );
};

export const NewPasswordWithHint = () => {
  const [value, setValue] = useState("correct-horse");
  return (
    <div style={{ width: 360, padding: 24 }}>
      <PasswordField
        id="new-password"
        label="Create a password"
        value={value}
        onChange={setValue}
        autoComplete="new-password"
        minLength={8}
        hint="At least 8 characters."
      />
    </div>
  );
};
