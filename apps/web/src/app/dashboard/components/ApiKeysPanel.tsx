"use client";

import React, { useState } from "react";
import type { CreateKeyResult } from "../views/useDashboardActions";
import { Key, Plus, Copy, Check, AlertCircle } from "lucide-react";
import { copyToClipboard } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CanaryKeyCard } from "./CanaryKeyCard";

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  rateLimitRpm: number;
  createdAt: string;
  lastUsedAt: string | null;
  status: "active" | "revoked";
}

interface ApiKeysPanelProps {
  apiKeys: ApiKeyItem[];
  onCreateKey: (name: string, rpm: number) => Promise<CreateKeyResult>;
  onRevokeKey: (id: string) => void;
}

export function ApiKeysPanel({
  apiKeys,
  onCreateKey,
  onRevokeKey,
}: ApiKeysPanelProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyRpm, setNewKeyRpm] = useState(60);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim() || isCreating) return;

    setIsCreating(true);
    setCreateError(null);
    const result = await onCreateKey(newKeyName, Number(newKeyRpm));
    setIsCreating(false);
    if (!result.ok) {
      const signIn = result.reason === "not_signed_in" || result.reason.startsWith("HTTP 401");
      setCreateError(`The key could not be created (${result.reason}).${signIn ? " Sign in again and retry." : ""}`);
      return;
    }
    setCreatedRawKey(result.key);
    setNewKeyName("");
  };

  const handleCopy = async (text: string, id?: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      if (id) {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      } else {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header action bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Key className="w-5 h-5 text-purple-400" />
            <span>API Key Credentials</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            A key lets the StealthMark SDK on your site report which AI agents it saw.
          </p>
        </div>

        <Button
          onClick={() => {
            setCreatedRawKey(null);
            setIsCreateModalOpen(true);
          }}
          variant="gradient"
          size="sm"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          <span>Create New API Key</span>
        </Button>
      </div>

      {/* Keys Table Card */}
      <Card variant="elevated" className="border-white/10">
        <div className="overflow-x-auto os-scroll">
          <table className="w-full text-left text-sm min-w-[600px]">
            <thead>
              <tr className="bg-[#0d1017] border-b border-white/10 text-slate-400 text-xs uppercase font-mono">
                <th className="p-4">Key Name</th>
                <th className="p-4">Prefix</th>
                <th className="p-4">Permissions</th>
                <th className="p-4">Rate Limit</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-slate-300">
              {apiKeys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400 font-mono text-xs">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Key className="w-6 h-6 text-slate-600" />
                      <span>No API credentials generated yet for this organization.</span>
                      <button
                        onClick={() => {
                          setCreatedRawKey(null);
                          setIsCreateModalOpen(true);
                        }}
                        className="text-cyan-400 hover:text-cyan-300 underline underline-offset-4 mt-1 cursor-pointer font-sans text-xs font-semibold"
                      >
                        + Generate your first Production Gateway Key
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                apiKeys.map((k) => (
                <tr key={k.id} className="hover:bg-white/[0.02] transition">
                  <td className="p-4 font-semibold text-white">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      <span>{k.name}</span>
                    </div>
                  </td>
                  <td className="p-4 font-mono text-xs text-purple-300">
                    {k.keyPrefix}
                  </td>
                  <td className="p-4">
                    <Badge variant="purple" size="sm">
                      {k.scopes.join(", ")}
                    </Badge>
                  </td>
                  <td className="p-4 font-mono text-xs text-slate-400">
                    {k.rateLimitRpm} RPM
                  </td>
                  <td className="p-4">
                    <Badge
                      variant={k.status === "active" ? "success" : "danger"}
                      size="sm"
                      pulse={k.status === "active"}
                    >
                      {k.status}
                    </Badge>
                  </td>
                  <td className="p-4 text-right">
                    {k.status === "active" ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => handleCopy(k.keyPrefix, k.id)}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition"
                          title="Copy prefix"
                        >
                          {copiedId === k.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => onRevokeKey(k.id)}
                          className="px-2.5 py-1 text-xs rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition cursor-pointer"
                        >
                          Revoke
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 italic">Revoked</span>
                    )}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </Card>

      <CanaryKeyCard />

      {/* Modal: Create API Key */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-md bg-[#0d1017] border border-white/15 rounded-3xl p-6 space-y-5 shadow-2xl relative">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-cyan-400" />
              <span>Generate API Key</span>
            </h3>

            {createdRawKey ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Copy your key now! For security, this secret token will never be displayed again.
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-black/60 border border-cyan-500/40 font-mono text-xs text-cyan-200 break-all flex items-center justify-between gap-2">
                  <span>{createdRawKey}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleCopy(createdRawKey)}
                    className="shrink-0"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>

                <Button
                  onClick={() => setIsCreateModalOpen(false)}
                  variant="primary"
                  className="w-full"
                >
                  Done
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmitCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5 font-mono">
                    Key Description / Name
                  </label>
                  <Input
                    required
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g. Production site"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5 font-mono">
                    Rate Limit (Requests / Min)
                  </label>
                  <Input
                    type="number"
                    min={10}
                    max={1200}
                    value={newKeyRpm}
                    onChange={(e) => setNewKeyRpm(Number(e.target.value))}
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="gradient" className="flex-1" disabled={isCreating}>
                    {isCreating ? "Generating..." : "Generate Key"}
                  </Button>
                </div>
                {createError && (
                  <p role="alert" className="text-xs text-red-400">
                    {createError}
                  </p>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
