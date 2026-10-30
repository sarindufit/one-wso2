// Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { ApprovalMatrix, MatrixSaveResult } from "@features/sales/cado2/approvals/api/approvalTypes";
import ApprovalMatrixPage from "./ApprovalMatrixPage";

const matrix: ApprovalMatrix = {
  groups: [
    {
      code: "PLATFORM",
      name: "Platform products",
      reviewers: [],
      ladder: [
        { role: "ACCOUNT_MANAGER", maxPercent: "5" },
        { role: "REGIONAL_DIRECTOR", maxPercent: "10" },
        { role: "AREA_GM", maxPercent: "20" },
        { role: "CRO", maxPercent: "33" },
        { role: "CFO", maxPercent: null },
      ],
    },
  ],
  mappings: [{ kind: "RULE", products: [], skuPattern: "", classification: "", productUnit: "APIM", groupCode: "PLATFORM" }],
  settings: {
    shortTermMonths: "12",
    longTermMonths: "36",
    paymentTermsDays: 45,
    downsellCeoPercent: "10",
    saasClassification: "CL",
    billingApproval: ["MONTHLY", "QUARTERLY", "SPECIAL_TERMS"],
    regionalRoles: ["REGIONAL_DIRECTOR", "AREA_GM"],
  },
  roles: [
    { code: "ACCOUNT_MANAGER", label: "Account Manager", ladder: true, reviewer: false },
    { code: "REGIONAL_DIRECTOR", label: "Regional Director", ladder: true, reviewer: false },
    { code: "AREA_GM", label: "Area GM", ladder: true, reviewer: false },
    { code: "CRO", label: "CRO", ladder: true, reviewer: false },
    { code: "CFO", label: "CFO", ladder: true, reviewer: false },
    { code: "LEGAL", label: "Legal", ladder: false, reviewer: true },
  ],
};

type SaveOpts = { onSuccess?: (r: MatrixSaveResult) => void };
const mutate = vi.fn((body: { confirm: boolean }, opts?: SaveOpts) =>
  opts?.onSuccess?.({
    saved: body.confirm,
    affected: [{ quoteId: 5, quoteNumber: "Q-26-00005", versionNumber: 1 }],
  }),
);
vi.mock("@features/sales/cado2/approvals/api/useApprovalApi", () => ({
  useApprovalMatrix: () => ({ data: matrix, isPending: false, error: null, isFetching: false, refetch: vi.fn() }),
  useMatrixChanges: () => ({ data: [], isPending: false, error: null, refetch: vi.fn() }),
  useSaveApprovalMatrix: () => ({ mutate, isPending: false, error: null }),
  useMatrixProducts: () => ({ data: [], isPending: false, error: null, refetch: vi.fn() }),
}));

describe("ApprovalMatrixPage", () => {
  it("checks the impact first, then saves and recalls on confirmation", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ApprovalMatrixPage />
      </MemoryRouter>,
    );
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    const agm = screen.getByLabelText("Area GM limit");
    await user.clear(agm);
    await user.type(agm, "25");
    await user.click(save);
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ confirm: false, matrix: expect.objectContaining({ groups: [expect.objectContaining({ ladder: expect.arrayContaining([{ role: "AREA_GM", maxPercent: "25" }]) })] }) }),
      expect.anything(),
    );

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/alters the approvals of 1 quote in approval/)).toBeInTheDocument();
    // Plain text: the admin panel gives no access to the quotes themselves.
    expect(dialog.getByText("Q-26-00005")).toBeInTheDocument();
    expect(dialog.queryByRole("link", { name: "Q-26-00005" })).toBeNull();
    // Red: it recalls other people's quotes (2026-10-13).
    expect(dialog.getByRole("button", { name: "Save and recall" })).toHaveClass("MuiButton-colorError");
    await user.click(dialog.getByRole("button", { name: "Save and recall" }));
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ confirm: true }), expect.anything());
    expect(await screen.findByText("Saved. 1 quote was recalled for resubmission.")).toBeInTheDocument();
  });

  it("shows the commercial rules with their fixed approvers", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ApprovalMatrixPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("tab", { name: "Commercial rules" }));
    expect(screen.getByText("Short-term deals")).toBeInTheDocument();
    expect(screen.getByLabelText("Above Net (days)")).toHaveValue("45");
    expect(screen.queryByText(/pending Sales' approval/)).toBeNull();
  });

  // D89: the admin chooses which billing frequencies need the CFO.
  it("saves the billing frequencies that need the CFO, in list order", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ApprovalMatrixPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("tab", { name: "Commercial rules" }));
    expect(screen.getByRole("checkbox", { name: "Monthly in Advance" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Annually in Advance" })).not.toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Quarterly in Advance" }));
    await user.click(screen.getByRole("checkbox", { name: "Upon the Execution of the Order Form" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        matrix: expect.objectContaining({
          settings: expect.objectContaining({ billingApproval: ["MONTHLY", "UPFRONT", "SPECIAL_TERMS"] }),
        }),
      }),
      expect.anything(),
    );
  });

  // D13: the regional roles; the Account Manager has no steps, so isn't listed.
  it("chooses which approvers are regional", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ApprovalMatrixPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("tab", { name: "Commercial rules" }));
    const regional = within(screen.getByText("Regional approvers").closest("div.MuiPaper-root") as HTMLElement);
    expect(regional.getByRole("checkbox", { name: "Regional Director" })).toBeChecked();
    expect(regional.getByRole("checkbox", { name: "CRO" })).not.toBeChecked();
    expect(regional.queryByRole("checkbox", { name: "Account Manager" })).toBeNull();

    await user.click(regional.getByRole("checkbox", { name: "Area GM" }));
    await user.click(regional.getByRole("checkbox", { name: "Legal" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        matrix: expect.objectContaining({
          settings: expect.objectContaining({ regionalRoles: ["REGIONAL_DIRECTOR", "LEGAL"] }),
        }),
      }),
      expect.anything(),
    );
  });
});
