10 REM The primes below 1000: the sieve of Eratosthenes
20 N% = 1000
30 DIM S%(N%)
40 FOR I% = 2 TO SQR(N%)
50   IF S%(I%) = 0 THEN FOR J% = I% * I% TO N% STEP I% : S%(J%) = 1 : NEXT
60 NEXT
70 C% = 0
80 FOR I% = 2 TO N%
90   IF S%(I%) = 0 THEN PRINT I%; : C% = C% + 1
100 NEXT
110 PRINT : PRINT C%; " primes"
