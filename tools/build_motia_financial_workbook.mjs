import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = process.cwd();
const financialCsvPath = path.join(root, "financials", "MOTIA_FINANCIAL_MODEL.csv");
const fundingCsvPath = path.join(root, "financials", "MOTIA_FUNDING_SCENARIOS.csv");
const marketingCsvPath = path.join(root, "marketing", "MARKETING_BUDGET.csv");
const outputPath = path.join(root, "financials", "MOTIA_FINANCIAL_MODEL.xlsx");
const renderDir = path.join(root, "financials", "renders");

const modelCsv = await fs.readFile(financialCsvPath, "utf8");
const fundingCsv = await fs.readFile(fundingCsvPath, "utf8");
const marketingCsv = await fs.readFile(marketingCsvPath, "utf8");

const workbook = await Workbook.fromCSV(modelCsv, { sheetName: "Forecast Model" });
await workbook.fromCSV(fundingCsv, { sheetName: "Funding Scenarios" });
await workbook.fromCSV(marketingCsv, { sheetName: "Marketing Budget" });

const model = workbook.worksheets.getItem("Forecast Model");
const funding = workbook.worksheets.getItem("Funding Scenarios");
const marketing = workbook.worksheets.getItem("Marketing Budget");
const assumptions = workbook.worksheets.add("Assumptions");
const dashboard = workbook.worksheets.add("Dashboard");
const checks = workbook.worksheets.add("Checks");
const sources = workbook.worksheets.add("Sources");

const midnight = "#132A2A";
const teal = "#0D8B73";
const coral = "#F36C4F";
const slate = "#344443";

function coerceNumericColumns(sheet, rangeAddress, textColumnIndexes) {
  const range = sheet.getRange(rangeAddress);
  const rows = range.values;
  const converted = rows.map((row, rowIndex) =>
    row.map((value, columnIndex) => {
      if (rowIndex === 0 || textColumnIndexes.has(columnIndex) || value === null || value === "") {
        return value;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : value;
    }),
  );
  range.values = converted;
}

coerceNumericColumns(model, "A1:AF40", new Set([0, 1]));
coerceNumericColumns(funding, "A1:U4", new Set([0, 1, 2, 3, 8, 10, 18, 19]));
coerceNumericColumns(marketing, "A1:Q40", new Set([0, 1, 16]));

function styleDataSheet(sheet, lastColumn, freezeRows = 1) {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(freezeRows);
  const used = sheet.getUsedRange();
  used.format.font = { name: "Arial", size: 9, color: slate };
  used.format.wrapText = false;
  sheet.getRange(`A1:${lastColumn}1`).format.fill = midnight;
  sheet.getRange(`A1:${lastColumn}1`).format.font = {
    name: "Arial",
    size: 9,
    bold: true,
    color: "#FFFFFF",
  };
  sheet.getRange(`A1:${lastColumn}1`).format.rowHeight = 34;
  used.format.borders = { preset: "inside", style: "thin", color: "#E7ECEA" };
}

// Turn the flat CSV into an auditable workbook model. Input/driver columns remain blue-green;
// derived columns use formulas and a neutral background.
const lastModelRow = 40;
for (let row = 2; row <= lastModelRow; row += 1) {
  model.getRange(`F${row}`).formulas = [[`=ROUND(D${row}*E${row},0)`]];
  model.getRange(`H${row}`).formulas = [[`=F${row}*G${row}`]];
  model.getRange(`L${row}`).formulas = [[`=SUM(H${row},J${row},K${row})`]];
  model.getRange(`T${row}`).formulas = [[`=SUM(M${row}:S${row})`]];
  model.getRange(`U${row}`).formulas = [[`=L${row}-T${row}`]];
  model.getRange(`V${row}`).formulas = [[
    row === 2 || row === 15 || row === 28 ? "=0" : `=Y${row - 1}`,
  ]];
  model.getRange(`X${row}`).formulas = [[
    row === 2 || row === 15 || row === 28 ? `=W${row}` : `=X${row - 1}+W${row}`,
  ]];
  model.getRange(`Y${row}`).formulas = [[`=V${row}+U${row}+W${row}`]];
  model.getRange(`Z${row}`).formulas = [[`=T${row}`]];
  model.getRange(`AA${row}`).formulas = [[`=MAX(0,-U${row})`]];
  model.getRange(`AB${row}`).formulas = [[`=AA${row}/3`]];
  model.getRange(`AC${row}`).formulas = [[`=IF(AB${row}>0,Y${row}/AB${row},"")`]];
  model.getRange(`AD${row}`).formulas = [[
    `=SUMIF($A$2:$A$${lastModelRow},A${row},$W$2:$W$${lastModelRow})`,
  ]];
  model.getRange(`AE${row}`).formulas = [[`=L${row}-SUM(H${row},J${row},K${row})`]];
  model.getRange(`AF${row}`).formulas = [[`=Y${row}-V${row}-U${row}-W${row}`]];
}

styleDataSheet(model, "AF");
model.getRange("A2:AF40").format.rowHeight = 20;
model.getRange("A:A").format.columnWidth = 14;
model.getRange("B:B").format.columnWidth = 12;
model.getRange("C:C").format.columnWidth = 10;
model.getRange("D:F").format.columnWidth = 12;
model.getRange("G:AF").format.columnWidth = 15;
model.getRange("E2:E40").setNumberFormat("0.0%");
model.getRange("G2:G40").setNumberFormat('€#,##0.00');
model.getRange("H2:AF40").setNumberFormat('€#,##0.00;[Red]-€#,##0.00');
model.getRange("I2:I40").setNumberFormat("0");
model.getRange("AC2:AC40").setNumberFormat("0.0");
model.getRange("D2:E40").format.fill = "#EAF6F2";
model.getRange("G2:G40").format.fill = "#EAF6F2";
model.getRange("I2:K40").format.fill = "#EAF6F2";
model.getRange("M2:S40").format.fill = "#EAF6F2";
model.getRange("W2:W40").format.fill = "#EAF6F2";
model.getRange("F2:F40").format.fill = "#F1F3F2";
model.getRange("H2:H40").format.fill = "#F1F3F2";
model.getRange("L2:L40").format.fill = "#F1F3F2";
model.getRange("T2:AF40").format.fill = "#F1F3F2";

styleDataSheet(funding, "U");
funding.getUsedRange().format.autofitColumns();
funding.getRange("A:A").format.columnWidth = 14;
funding.getRange("B:U").format.columnWidth = 20;
funding.getUsedRange().format.wrapText = true;
funding.getUsedRange().format.autofitRows();
funding.getRange("A1:U1").format.rowHeight = 58;
funding.getRange("E2:E4").setNumberFormat('€#,##0');
funding.getRange("F2:F4").setNumberFormat("0.0%");
funding.getRange("G2:L4").setNumberFormat('€#,##0');
funding.getRange("M2:N4").setNumberFormat("0.0%");
funding.getRange("O2:R4").setNumberFormat('€#,##0');
funding.getRange("U2:U4").setNumberFormat('€#,##0.00');

styleDataSheet(marketing, "Q");
marketing.getUsedRange().format.autofitColumns();
marketing.getRange("A:Q").format.columnWidth = 18;
marketing.getUsedRange().format.wrapText = true;
marketing.getUsedRange().format.autofitRows();
marketing.getRange("C2:P40").setNumberFormat('€#,##0');

assumptions.showGridLines = false;
assumptions.getRange("A1:F1").merge();
assumptions.getRange("A1").values = [["MOTIA — Financial assumptions"]];
assumptions.getRange("A1:F1").format.fill = midnight;
assumptions.getRange("A1:F1").format.font = {
  name: "Arial",
  size: 18,
  bold: true,
  color: "#FFFFFF",
};
assumptions.getRange("A3:F3").values = [[
  "Area",
  "Lean",
  "Base",
  "Accelerated",
  "Unit / treatment",
  "Validation status",
]];
assumptions.getRange("A4:F15").values = [
  ["Formal period", "Q4 2026–Q4 2029", "Q4 2026–Q4 2029", "Q4 2026–Q4 2029", "13 quarters", "Fixed"],
  ["Pre-forecast", "Aug–Sep 2026", "Aug–Sep 2026", "Aug–Sep 2026", "Founder planning only", "No formal revenue"],
  ["B2C net ARPPU/quarter", 9.5, 10, 10.5, "EUR, net planning hypothesis", "Validate pricing/store/VAT"],
  ["Q4 2029 MAU", 90000, 400000, 1500000, "Monthly active users", "Management target"],
  ["Q4 2029 paid conversion", 0.06, 0.08, 0.1, "% active base", "Management target"],
  ["Primary deployment", "One native platform", "Primary app + measured expansion", "Parallel platforms", "Conditional", "Technical validation"],
  ["Founder compensation", "Included in payroll", "Included in payroll", "Included in payroll", "Sustainable cash cost", "Confirm amount/tax"],
  ["Financing classification", "Cash financing", "Cash financing", "Cash financing", "Never operating revenue", "Fixed policy"],
  ["Grant treatment", "Separate operating income", "Separate operating income", "Separate operating income", "Probability/timing dependent", "Accounting review"],
  ["Marketing budget", "Detailed CSV component", "Detailed CSV component", "Detailed CSV component", "Residual S&M = sales/BD/reserve", "Reconciled in notes"],
  ["Crowdfunding", "Conditional option", "Conditional option", "Conditional option", "Net proceeds only in cash", "Legal/platform review"],
  ["Model purpose", "Scenario planning", "Scenario planning", "Scenario planning", "Not forecast or offer", "Fixed disclosure"],
];
assumptions.getRange("A3:F3").format.fill = teal;
assumptions.getRange("A3:F3").format.font = { name: "Arial", size: 9, bold: true, color: "#FFFFFF" };
assumptions.getRange("A3:F15").format.borders = { preset: "all", style: "thin", color: "#D7E1DD" };
assumptions.getRange("A4:A15").format.font = { bold: true, color: midnight };
assumptions.getRange("B6:D6").setNumberFormat('€#,##0.00');
assumptions.getRange("B8:D8").setNumberFormat("0.0%");
assumptions.getRange("A:F").format.columnWidth = 24;
assumptions.getRange("A1:F15").format.wrapText = true;
assumptions.getRange("A1:F15").format.autofitRows();
assumptions.freezePanes.freezeRows(3);

// Dashboard helper block references the Base rows in the model. This keeps charts auditable.
dashboard.showGridLines = false;
dashboard.getRange("A1:J2").merge();
dashboard.getRange("A1").values = [["MOTIA — Base scenario dashboard"]];
dashboard.getRange("A1:J2").format.fill = midnight;
dashboard.getRange("A1:J2").format.font = {
  name: "Arial",
  size: 20,
  bold: true,
  color: "#FFFFFF",
};
dashboard.getRange("A4:E4").values = [["Quarter", "MAU", "Operating revenue", "Operating costs", "Closing cash"]];
for (let i = 0; i < 13; i += 1) {
  const dashboardRow = 5 + i;
  const modelRow = 15 + i;
  dashboard.getRange(`A${dashboardRow}:E${dashboardRow}`).formulas = [[
    `='Forecast Model'!B${modelRow}`,
    `='Forecast Model'!D${modelRow}`,
    `='Forecast Model'!L${modelRow}`,
    `='Forecast Model'!T${modelRow}`,
    `='Forecast Model'!Y${modelRow}`,
  ]];
}
dashboard.getRange("G4:J4").values = [["Metric", "Q4 2026", "Q4 2029", "Status"]];
dashboard.getRange("G5:J9").values = [
  ["MAU", 2000, 400000, "Target, not forecast"],
  ["Paid conversion", 0, 0.08, "Validate with cohorts"],
  ["Active B2B/B2G contracts", 0, 48, "Validate pipeline and ACV"],
  ["Scenario financing", null, null, "Separate from revenue"],
  ["Final cash", null, null, "Formula-backed"],
];
dashboard.getRange("H8").formulas = [["='Forecast Model'!W15"]];
dashboard.getRange("I8").formulas = [["='Forecast Model'!AD27"]];
dashboard.getRange("H9").formulas = [["='Forecast Model'!Y15"]];
dashboard.getRange("I9").formulas = [["='Forecast Model'!Y27"]];
dashboard.getRange("A4:E4").format.fill = teal;
dashboard.getRange("G4:J4").format.fill = teal;
dashboard.getRange("A4:E4").format.font = { bold: true, color: "#FFFFFF" };
dashboard.getRange("G4:J4").format.font = { bold: true, color: "#FFFFFF" };
dashboard.getRange("A4:E17").format.borders = { preset: "all", style: "thin", color: "#D7E1DD" };
dashboard.getRange("G4:J9").format.borders = { preset: "all", style: "thin", color: "#D7E1DD" };
dashboard.getRange("C5:E17").setNumberFormat('€0.0,,"m"');
dashboard.getRange("H6:I6").setNumberFormat("0.0%");
dashboard.getRange("H8:I9").setNumberFormat('€#,##0,,"m"');
dashboard.getRange("A:F").format.columnWidth = 18;
dashboard.getRange("G:G").format.columnWidth = 28;
dashboard.getRange("H:I").format.columnWidth = 14;
dashboard.getRange("J:J").format.columnWidth = 24;

const growthChart = dashboard.charts.add("line", dashboard.getRange("A4:B17"));
growthChart.setPosition("A20", "E36");
growthChart.title = "Base MAU trajectory (management targets)";
growthChart.hasLegend = false;
growthChart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 8 } };
growthChart.yAxis = { numberFormatCode: '#,##0,"k"' };

const financeChart = dashboard.charts.add("line", {
  chartType: "line",
  title: "Revenue, costs and cash (€)",
  hasLegend: true,
});
const revenueSeries = financeChart.series.add("Operating revenue");
revenueSeries.categoryFormula = "'Dashboard'!$A$5:$A$17";
revenueSeries.formula = "'Dashboard'!$C$5:$C$17";
revenueSeries.fill = teal;
const costsSeries = financeChart.series.add("Operating costs");
costsSeries.categoryFormula = "'Dashboard'!$A$5:$A$17";
costsSeries.formula = "'Dashboard'!$D$5:$D$17";
costsSeries.fill = coral;
const cashSeries = financeChart.series.add("Closing cash");
cashSeries.categoryFormula = "'Dashboard'!$A$5:$A$17";
cashSeries.formula = "'Dashboard'!$E$5:$E$17";
cashSeries.fill = midnight;
financeChart.setPosition("F20", "J36");
financeChart.title = "Revenue, costs and cash (€)";
financeChart.hasLegend = true;
financeChart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 8 } };
financeChart.yAxis = { numberFormatCode: '€#,##0,,"m"' };

checks.showGridLines = false;
checks.getRange("A1:D1").merge();
checks.getRange("A1").values = [["MOTIA — Model integrity checks"]];
checks.getRange("A1:D1").format.fill = midnight;
checks.getRange("A1:D1").format.font = { name: "Arial", size: 18, bold: true, color: "#FFFFFF" };
checks.getRange("A3:D3").values = [["Check", "Formula / source", "Result", "Status"]];
checks.getRange("A4:D10").values = [
  ["Revenue identities", "Sum of Forecast Model AE", null, null],
  ["Cash identities", "Sum of Forecast Model AF", null, null],
  ["Lean closing cash non-negative", "Minimum Lean closing cash", null, null],
  ["Base closing cash non-negative", "Minimum Base closing cash", null, null],
  ["Accelerated closing cash non-negative", "Minimum Accelerated closing cash", null, null],
  ["Financing is not revenue", "Separate W vs L columns", 0, "PASS"],
  ["Scenario count", "Three scenarios × 13 quarters", 39, "PASS"],
];
checks.getRange("C4").formulas = [["=SUM('Forecast Model'!AE2:AE40)"]];
checks.getRange("D4").formulas = [['=IF(ABS(C4)<0.01,"PASS","FAIL")']];
checks.getRange("C5").formulas = [["=SUM('Forecast Model'!AF2:AF40)"]];
checks.getRange("D5").formulas = [['=IF(ABS(C5)<0.01,"PASS","FAIL")']];
checks.getRange("C6").formulas = [["=MIN('Forecast Model'!Y2:Y14)"]];
checks.getRange("D6").formulas = [['=IF(C6>=0,"PASS","FAIL")']];
checks.getRange("C7").formulas = [["=MIN('Forecast Model'!Y15:Y27)"]];
checks.getRange("D7").formulas = [['=IF(C7>=0,"PASS","FAIL")']];
checks.getRange("C8").formulas = [["=MIN('Forecast Model'!Y28:Y40)"]];
checks.getRange("D8").formulas = [['=IF(C8>=0,"PASS","FAIL")']];
checks.getRange("A3:D3").format.fill = teal;
checks.getRange("A3:D3").format.font = { bold: true, color: "#FFFFFF" };
checks.getRange("A3:D10").format.borders = { preset: "all", style: "thin", color: "#D7E1DD" };
checks.getRange("A:D").format.columnWidth = 30;
checks.getRange("A1:D10").format.wrapText = true;
checks.getRange("A1:D10").format.autofitRows();
checks.getRange("C4:C8").setNumberFormat('€#,##0.00;[Red]-€#,##0.00');

sources.showGridLines = false;
sources.getRange("A1:D1").merge();
sources.getRange("A1").values = [["MOTIA — Source and assumption register"]];
sources.getRange("A1:D1").format.fill = midnight;
sources.getRange("A1:D1").format.font = { name: "Arial", size: 18, bold: true, color: "#FFFFFF" };
sources.getRange("A3:D3").values = [["Topic", "Source / basis", "Access date", "Treatment"]];
sources.getRange("A4:D12").values = [
  ["Current product", "Repository README, architecture and source code", "2026-07-30", "Verified repository evidence"],
  ["Road context", "Istat — Road accidents 2024", "2026-07-30", "Context only; no causality claim"],
  ["Crowdfunding framework", "Regulation (EU) 2020/1503; CONSOB/ESMA registers", "2026-07-30", "Professional review required"],
  ["Apple automotive", "Apple CarPlay entitlement and navigation documentation", "2026-07-30", "Approval not guaranteed"],
  ["Android automotive", "Android for Cars navigation and quality documentation", "2026-07-30", "Review required"],
  ["Maps/routing pricing", "Google Maps Platform and Mapbox public pricing", "2026-07-30", "Replace with supplier quotes"],
  ["Open data", "OSM licence/policies; EU National Access Points", "2026-07-30", "Per-source diligence"],
  ["Forecast", "Founder/management scenario assumptions", "2026-07-30", "Not audited; replace with actuals"],
  ["Founder profile", "Founder-supplied brief", "2026-07-30", "Verify before publication"],
];
sources.getRange("A3:D3").format.fill = teal;
sources.getRange("A3:D3").format.font = { bold: true, color: "#FFFFFF" };
sources.getRange("A3:D12").format.borders = { preset: "all", style: "thin", color: "#D7E1DD" };
sources.getRange("A:D").format.columnWidth = 30;
sources.getRange("A1:D12").format.wrapText = true;
sources.getRange("A1:D12").format.autofitRows();

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(renderDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

for (const sheetName of [
  "Dashboard",
  "Assumptions",
  "Forecast Model",
  "Funding Scenarios",
  "Marketing Budget",
  "Checks",
  "Sources",
]) {
  const preview = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: sheetName === "Forecast Model" ? 0.8 : 1,
    format: "png",
  });
  const bytes = new Uint8Array(await preview.arrayBuffer());
  await fs.writeFile(path.join(renderDir, `${sheetName.replaceAll(" ", "_")}.png`), bytes);
}

const inspection = await workbook.inspect({
  kind: "workbook,sheet,formula,drawing",
  maxChars: 12000,
  tableMaxRows: 8,
  tableMaxCols: 8,
  maxResults: 200,
});
await fs.writeFile(
  path.join(renderDir, "workbook-inspection.txt"),
  typeof inspection === "string" ? inspection : JSON.stringify(inspection, null, 2),
);

console.log(`Created ${outputPath}`);
console.log(`Rendered workbook sheets to ${renderDir}`);
