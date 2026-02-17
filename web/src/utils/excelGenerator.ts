import ExcelJS from 'exceljs';

export interface ValidationExportResult {
    row: any;
    isValid: boolean;
    errors: string[];
    fieldErrors: Record<string, boolean>; // e.g., {'guest_name': true}
    mappings: Record<string, string>; // CSV Header -> DB Field (e.g. "Guest Name" -> "guest_name")
}

export const generateErrorExcel = async (results: ValidationExportResult[]): Promise<Blob> => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Validation Errors');

    if (results.length === 0) return new Blob([]);

    // Headers: CSV Columns + Status + Right Cause
    const firstRow = results[0].row;
    const csvHeaders = Object.keys(firstRow);
    const headers = [...csvHeaders, "Validation Status", "Right Cause"];

    // Add Header Row
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEEEEEE' } // Light Gray
    };

    // Add Data Rows
    results.forEach((res) => {
        const rowData = [
            ...csvHeaders.map(h => res.row[h]),
            res.isValid ? "Valid" : "Error",
            res.errors.join("; ")
        ];

        const row = worksheet.addRow(rowData);

        // Styling Logic
        if (!res.isValid) {
            // 1. Highlight the Row Background (Light Red)
            row.eachCell((cell) => {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFEBEB' } // Very light red background
                };
            });

            // 2. Highlight Specific Invalid Cells (Red Text / Bold)
            // We need to match CSV Header -> Mapped Field -> Field Error
            csvHeaders.forEach((csvHeader, colIndex) => {
                const dbField = res.mappings[csvHeader]; // e.g. "guest_name"
                if (dbField && res.fieldErrors[dbField]) {
                    // This specific cell is invalid!
                    const cell = row.getCell(colIndex + 1); // 1-indexed
                    cell.font = {
                        color: { argb: 'FFFF0000' }, // Red Text
                        bold: true
                    };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFCCCC' } // Slightly darker red background for specific error cell
                    };
                }
            });

            // Status Column Style (Last 2 cols)
            const statusCell = row.getCell(headers.length - 1);
            statusCell.font = { color: { argb: 'FFFF0000' }, bold: true };

            const detailCell = row.getCell(headers.length);
            detailCell.font = { color: { argb: 'FFFF0000' }, italic: true };
        }
    });

    // Auto-width columns (loose approximation)
    worksheet.columns.forEach(column => {
        column.width = 20;
    });

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};
