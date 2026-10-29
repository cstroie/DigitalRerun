;	PLAY: start the program of this disk
;
;	Puts a command (the line below) into the CCP's command buffer and
;	enters the CCP, which runs it as if it had been typed. build.js
;	fills in the command from the disk's disk.json ("play"). A>PLAY
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.

bdos	equ	0005h
getdsk	equ	25
getusr	equ	32

	org	100h
	lhld	6		;the BDOS entry: its page is the BDOS's
	mvi	l,0
	mov	a,h
	sui	8		;the CCP is 800h below
	mov	h,a
	push	h		;ccp
	lxi	d,7
	dad	d		;ccp+7: the command length
	mvi	m,cmdend-cmd
	inx	h		;ccp+8: the command
	push	h
	lxi	d,80h		;comaddr, where the scan resumes, follows the 128 byte buffer;
	dad	d		;the scan of PLAY left it past the name: back to the start
	pop	d
	mov	m,e
	inx	h
	mov	m,d
	lxi	h,cmd
	mvi	b,cmdend-cmd+1	;and the 0 that ends it
copy:	mov	a,m
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	copy
	mvi	c,getdsk
	call	bdos
	sta	disk
	mvi	c,getusr
	mvi	e,0ffh
	call	bdos
	rlc
	rlc
	rlc
	rlc
	mov	b,a
	lda	disk
	ora	b
	mov	c,a		;the user and disk the CCP expects in C
	pop	h
	pchl			;into the CCP: it runs the command

disk:	db	0
cmd:	db	'@CMD@'
cmdend:	db	0
