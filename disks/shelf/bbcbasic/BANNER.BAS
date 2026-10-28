10 REM A heading on the printer, in large letters (VDU 2 sends output to it)
20 INPUT "Text", T$
30 VDU 2
40 PRINT CHR$(27); "W"; CHR$(1); T$; CHR$(27); "W"; CHR$(0)
50 PRINT
60 VDU 3
70 PRINT "Printed: see PAPER."
