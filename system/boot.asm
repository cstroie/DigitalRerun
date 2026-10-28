;	jscpm cold-start loader
;
;	The boot ROM reads this sector (track 0, sector 1 of A:) into
;	0000h and starts the CPU there. It reads CCP, BDOS and BIOS from
;	the rest of the two system tracks into memory and jumps to the
;	BIOS cold-start entry. Assembles with ASM.COM too.
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.

msize	equ	64		;memory size in Kbytes
ccp	equ	(msize-7)*1024	;base of CCP: 0E400h for 64K
bios	equ	ccp+1600h	;base of BIOS
nsects	equ	51		;sectors 2-26 of track 0, 1-26 of track 1

;	disk controller ports (z80pack)
fdcd	equ	10		;drive
fdct	equ	11		;track
fdcs	equ	12		;sector, low byte
fdcsh	equ	17		;sector, high byte
fdcop	equ	13		;command: 0 read, 1 write
fdcst	equ	14		;status: 0 ok
dmal	equ	15		;DMA address, low byte
dmah	equ	16		;DMA address, high byte
cond	equ	1		;console data

	org	0
	lxi	sp,100h
	xra	a
	out	fdcd		;drive A:
	out	fdcsh
	mov	e,a		;track 0
	lxi	h,ccp		;load address
	mvi	b,2		;first sector
	mvi	c,nsects	;sectors to read
loop:	mov	a,e
	out	fdct
	mov	a,b
	out	fdcs
	mov	a,l
	out	dmal
	mov	a,h
	out	dmah
	xra	a
	out	fdcop		;read
	in	fdcst
	ora	a
	jnz	fail
	push	d
	lxi	d,128
	dad	d		;next load address
	pop	d
	dcr	c
	jz	bios		;all read: cold start
	inr	b
	mov	a,b
	cpi	27
	jc	loop
	mvi	b,1		;next track
	inr	e
	jmp	loop

fail:	lxi	h,msg
fail1:	mov	a,m
	ora	a
	jz	stop
	out	cond
	inx	h
	jmp	fail1
stop:	hlt

msg:	db	13,10,'BOOT ERROR',13,10,0
	end
