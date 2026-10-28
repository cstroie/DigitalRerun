;	SYSGEN for DigitalRerun: copy the system tracks
;
;	Reads the two system tracks of a drive into memory and writes
;	them to another, the way CP/M's own SYSGEN did. The image sits
;	where CP/M 2.2 put it, so the usual recipes work:
;
;	  0900h  loader (track 0, sector 1)
;	  0980h  CCP    (runs at 0E400h)
;	  1180h  BDOS   (runs at 0EC00h)
;	  1F80h  BIOS   (runs at 0FA00h): DDT offset 2580h
;
;	Answer the source question with RETURN to write the image that
;	is already in memory (after SAVE 34 CPM64.COM / DDT CPM64.COM).
;	Uses the BIOS directly: no sector translation, sectors 1-26.
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.

bdos	equ	0005h
image	equ	0900h		;where the system image goes
tracks	equ	2		;system tracks
spt	equ	26		;sectors per track
cr	equ	13
lf	equ	10

	org	100h
	lhld	1		;HL = BIOS warm start entry (base + 3)
	lxi	d,24		;SELDSK is base + 27
	dad	d
	shld	seldsk+1
	call	next3
	shld	settrk+1
	call	next3
	shld	setsec+1
	call	next3
	shld	setdma+1
	call	next3
	shld	read+1
	call	next3
	shld	write+1
	lxi	sp,stack

	lxi	d,signon
	call	print

;	source
	lxi	d,asksrc
	call	print
	call	getdrv
	jc	dest		;RETURN: use the image in memory
	sta	drive
	adi	'A'
	sta	srcd
	lxi	d,putsrc
	call	print
	call	waitcr
	mvi	a,0		;read
	call	rwsys
	jc	dest
	lxi	d,done
	call	print

;	destinations, until RETURN
dest:	lxi	d,askdst
	call	print
	call	getdrv
	jc	reboot
	sta	drive
	adi	'A'
	sta	dstd
	lxi	d,putdst
	call	print
	call	waitcr
	mvi	a,1		;write
	call	rwsys
	jc	dest
	lxi	d,done
	call	print
	jmp	dest

reboot:	lxi	d,crlf
	call	print
	jmp	0

;	HL = HL + 3
next3:	inx	h
	inx	h
	inx	h
	ret

;	read (A = 0) or write (A = 1) the system tracks of DRIVE
;	from/to IMAGE; carry set on an error (after saying so)
rwsys:	sta	rwflag
	lda	drive
	mov	c,a
	call	seldsk
	mov	a,h
	ora	l
	jz	selerr
	lxi	d,10		;DPH+10: the DPB
	dad	d
	mov	e,m
	inx	h
	mov	d,m
	lxi	h,13		;DPB+13: system tracks
	dad	d
	mov	a,m
	cpi	tracks
	jc	nosys
	lxi	h,image
	shld	addr
	xra	a
	sta	trk
rwtrk:	lda	trk
	mov	c,a
	mvi	b,0
	call	settrk
	mvi	a,1
	sta	sec
rwsec:	lda	sec
	mov	c,a
	mvi	b,0
	call	setsec
	lhld	addr
	mov	b,h
	mov	c,l
	call	setdma
	lda	rwflag
	ora	a
	jnz	rwwr
	call	read
	jmp	rwchk
rwwr:	mvi	c,0
	call	write
rwchk:	ora	a
	jnz	ioerr
	lhld	addr
	lxi	d,128
	dad	d
	shld	addr
	lda	sec
	inr	a
	sta	sec
	cpi	spt+1
	jc	rwsec
	lda	trk
	inr	a
	sta	trk
	cpi	tracks
	jc	rwtrk
	ora	a		;clear carry
	ret

selerr:	lxi	d,nodrv
	call	print
	stc
	ret
nosys:	lxi	d,nosyst
	call	print
	stc
	ret
ioerr:	lxi	d,perm
	call	print
	stc
	ret

;	read a drive letter: A = drive number, carry set on RETURN
getdrv:	mvi	c,1
	call	bdos
	cpi	cr
	jz	getcr
	ani	5fh		;upper case
	sui	'A'
	jc	badin
	cpi	16
	jnc	badin
	ora	a
	ret
getcr:	stc
	ret
badin:	lxi	d,what
	call	print
	jmp	getdrv

;	wait for RETURN
waitcr:	mvi	c,1
	call	bdos
	cpi	cr
	jnz	waitcr
	ret

print:	mvi	c,9
	jmp	bdos

;	BIOS entries, patched at start
seldsk:	jmp	0
settrk:	jmp	0
setsec:	jmp	0
setdma:	jmp	0
read:	jmp	0
write:	jmp	0

signon:	db	'DIGITALRERUN SYSGEN VER 1.0',cr,lf,'$'
asksrc:	db	cr,lf,'SOURCE DRIVE NAME (OR RETURN TO SKIP) $'
putsrc:	db	cr,lf,'SOURCE ON '
srcd:	db	'A, THEN TYPE RETURN $'
askdst:	db	cr,lf,'DESTINATION DRIVE NAME (OR RETURN TO REBOOT) $'
putdst:	db	cr,lf,'DESTINATION ON '
dstd:	db	'A, THEN TYPE RETURN $'
done:	db	cr,lf,'FUNCTION COMPLETE$'
nodrv:	db	cr,lf,'NO SUCH DRIVE$'
perm:	db	cr,lf,'PERMANENT ERROR$'
nosyst:	db	cr,lf,'NO SYSTEM TRACKS ON THAT DRIVE$'
what:	db	cr,lf,'? $'
crlf:	db	cr,lf,'$'

drive:	ds	1
rwflag:	ds	1
trk:	ds	1
sec:	ds	1
addr:	ds	2
	ds	64
stack:
	end
