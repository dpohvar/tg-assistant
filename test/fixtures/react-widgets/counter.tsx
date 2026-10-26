import { useState } from "react";
import { defineStore } from "@tg-assistant/widget";
defineStore({ version: 1, initialState: { count: 0 } });
export function Main() {
  const [clicks] = useState(0);
  return <p>Counter {clicks}</p>;
}
