10 REM The Mandelbrot set, in characters
20 C$ = " .:-=+*#%"
30 FOR Y = -12 TO 12
40   L$ = ""
50   FOR X = -39 TO 39
60     CR = X / 20 - 0.6 : CI = Y / 10
70     ZR = 0 : ZI = 0 : N% = 0
80     REPEAT
90       T = ZR * ZR - ZI * ZI + CR
100      ZI = 2 * ZR * ZI + CI : ZR = T
110      N% = N% + 1
120    UNTIL N% = 30 OR ZR * ZR + ZI * ZI > 4
130    IF N% = 30 THEN L$ = L$ + "@" ELSE L$ = L$ + MID$(C$, 1 + (N% MOD 9), 1)
140  NEXT
150  PRINT L$
160 NEXT
