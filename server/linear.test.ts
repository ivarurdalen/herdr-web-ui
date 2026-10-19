import { describe, expect, it } from "bun:test";
import { credentialsKey, linearClient, linearIdentifiers, titleIdentifier } from "./linear.ts";

describe("linear", () => {
  it("finds issue ids in text and at the head of a PR title", () => {
    expect(linearIdentifiers("Fixes ENG-12 and ENG-12, see OPS-3; not eng-4 or ENG-0")).toEqual(["ENG-12", "OPS-3"]);
    expect(titleIdentifier("[ENG-12] retry the upload")).toBe("ENG-12");
    expect(titleIdentifier("ENG-12: retry")).toBe("ENG-12");
    expect(titleIdentifier("retry ENG-12")).toBeNull();
  });

  it("reads the workspace's key from the linear CLI's credentials", () => {
    expect(credentialsKey('default = "lin_a"\nexabel = "lin_b"\n', "exabel")).toBe("lin_b");
    expect(credentialsKey('default = "lin_a"\n', "exabel")).toBeNull();
  });

  it("looks up only ids of the workspace's teams, and sends the key", async () => {
    const seen: string[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("authorization")!);
      const body = JSON.parse(init.body as string) as { variables: { id?: string } };
      const data = body.variables.id === undefined
        ? { teams: { nodes: [{ key: "ENG" }] } }
        : { issue: { identifier: body.variables.id, url: `https://linear.app/x/issue/${body.variables.id}`, title: "T", state: { name: "Done" } } };
      return Response.json({ data });
    }) as unknown as typeof fetch;
    const client = linearClient(fake, "lin_key")!;
    const found = await client.issues(["ENG-1", "UTF-8"]);
    expect([...found.keys()]).toEqual(["ENG-1"]);
    expect(found.get("ENG-1")).toEqual({ identifier: "ENG-1", url: "https://linear.app/x/issue/ENG-1", title: "T", state: "Done" });
    expect(new Set(seen)).toEqual(new Set(["lin_key"]));
    expect(linearClient(fake, null)).toBeNull();
  });
});
