"use client";

import React from "react";
import { Terminal, Sparkles, KeyRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";

interface McpPanelProps {
  apiKey: string | null;
}

export function McpPanel({ apiKey }: McpPanelProps) {
  if (apiKey === null) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <span>Model Context Protocol (MCP) Integration</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Equip Cursor, Claude Code, Windsurf, and autonomous agent loops with native Agent Gateway tools.
          </p>
        </div>
        <Card variant="elevated" className="border-white/10 p-6 space-y-2">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-cyan-400" />
            <span>No API key available</span>
          </h3>
          <p className="text-xs text-slate-400">
            Create an API key in the Keys tab to configure MCP. A key is shown only once, right after it is created.
          </p>
        </Card>
      </div>
    );
  }

  const mcpCliCommand = `npx -y @stealthmark/mcp-server --api-key=${apiKey}`;

  const cursorJson = JSON.stringify(
    {
      mcpServers: {
        stealthmark: {
          command: "npx",
          args: ["-y", "@stealthmark/mcp-server"],
          env: {
            STEALTHMARK_API_KEY: apiKey,
          },
        },
      },
    },
    null,
    2
  );

  const claudeDesktopJson = JSON.stringify(
    {
      mcpServers: {
        stealthmark: {
          command: "npx",
          args: ["-y", "@stealthmark/mcp-server"],
          env: {
            STEALTHMARK_API_KEY: apiKey,
          },
        },
      },
    },
    null,
    2
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <Terminal className="w-5 h-5 text-cyan-400" />
          <span>Model Context Protocol (MCP) Integration</span>
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 mt-1">
          Equip Cursor, Claude Code, Windsurf, and autonomous agent loops with native Agent Gateway tools.
        </p>
      </div>

      {/* 1-Line CLI Command */}
      <Card variant="elevated" className="border-white/10 p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>MCP server bridge</span>
          </h3>
          <Badge variant="warning" size="sm">
            Not on npm yet
          </Badge>
        </div>
        <p className="text-xs text-slate-400">
          The <code className="text-cyan-300">@stealthmark/mcp-server</code> package is not published to npm yet, so this
          command returns a 404 today. This is the command it will use
          once it is published:
        </p>
        <CodeBlock code={mcpCliCommand} language="bash" title="Terminal" />
      </Card>

      {/* Grid of IDE Configs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cursor IDE */}
        <Card variant="default" className="border-white/10 p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Cursor Integration</h3>
            <span className="text-xs font-mono text-purple-300">~/.cursor/mcp.json</span>
          </div>
          <p className="text-xs text-slate-400">
            Once the package is published, add this to your Cursor settings to enable <code className="text-cyan-300">gateway_resolve</code> and <code className="text-cyan-300">gateway_invoke</code> tools in agent chats:
          </p>
          <CodeBlock code={cursorJson} language="json" title="Cursor Configuration" />
        </Card>

        {/* Claude Desktop */}
        <Card variant="default" className="border-white/10 p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Claude Desktop</h3>
            <span className="text-xs font-mono text-purple-300">claude_desktop_config.json</span>
          </div>
          <p className="text-xs text-slate-400">
            Once the package is published, paste this into your Claude Desktop MCP config file to allow Claude to interact with websites that run the StealthMark agent control layer:
          </p>
          <CodeBlock code={claudeDesktopJson} language="json" title="Claude Desktop Configuration" />
        </Card>
      </div>
    </div>
  );
}
